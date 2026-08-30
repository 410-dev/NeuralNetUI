using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;

internal static class Program
{
    private const int ServiceWin32OwnProcess = 0x10;
    private const int ServiceStartPending = 2;
    private const int ServiceStopPending = 3;
    private const int ServiceRunning = 4;
    private const int ServiceStopped = 1;
    private const int ServiceAcceptStop = 1;
    private const int ServiceControlStop = 1;
    private static readonly CancellationTokenSource StopSource = new();
    private static ServiceControlHandler? handler;
    private static IntPtr statusHandle;
    private static ServiceOptions? options;
    private static TextWriter? log;
    private static Process? node;
    private static bool consoleMode;

    public static int Main(string[] args)
    {
        if (args.Length >= 1 && args[0].Equals("--configure", StringComparison.OrdinalIgnoreCase))
            return Configure(args);
        if (args.Length >= 1 && args[0].Equals("--remove-firewall", StringComparison.OrdinalIgnoreCase))
            return RemoveFirewallRules();

        options = ServiceOptions.Parse(args);
        Directory.CreateDirectory(options.DataDirectory);
        log = TextWriter.Synchronized(new StreamWriter(Path.Combine(options.DataDirectory, "service.log"), append: true) { AutoFlush = true });

        consoleMode = args.Contains("--console", StringComparer.OrdinalIgnoreCase);
        if (consoleMode)
        {
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; StopSource.Cancel(); };
            RunAsync().GetAwaiter().GetResult();
            return 0;
        }

        handler = ControlHandler;
        ServiceMainDelegate serviceMain = ServiceMain;
        var table = new[]
        {
            new ServiceTableEntry { ServiceName = "NeuralChat", ServiceMain = serviceMain },
            new ServiceTableEntry()
        };
        if (!StartServiceCtrlDispatcher(table))
        {
            WriteLog($"Unable to connect to Service Control Manager: {Marshal.GetLastWin32Error()}");
            return 1;
        }
        GC.KeepAlive(serviceMain);
        GC.KeepAlive(handler);
        return 0;
    }

    private static int Configure(string[] args)
    {
        if (args.Length != 4 || !int.TryParse(args[3], out int port) || port is < 1 or > 65535)
            return 2;
        string mode = args[2].ToLowerInvariant();
        if (mode is not ("lan" or "tailscale" or "lan-and-tailscale")) return 3;
        string configPath = Path.GetFullPath(args[1]);
        Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);
        string tempPath = configPath + ".tmp";
        File.WriteAllText(tempPath,
            "{\n  \"server\": {\n    \"host\": \"0.0.0.0\",\n" +
            $"    \"port\": {port},\n    \"accessMode\": \"{mode}\"\n  }}\n}}\n");
        File.Move(tempPath, configPath, true);
        UpdateFirewallRules(port);
        return 0;
    }

    private static void UpdateFirewallRules(int port)
    {
        RemoveFirewallRules();
        RunNetsh("advfirewall", "firewall", "add", "rule", "name=Neural Chat (LAN and Tailscale IPv4)",
            "dir=in", "action=allow", $"program={Environment.ProcessPath}", "protocol=TCP", $"localport={port}",
            "remoteip=LocalSubnet,100.64.0.0/10", "profile=any", "enable=yes");
        RunNetsh("advfirewall", "firewall", "add", "rule", "name=Neural Chat (Tailscale IPv6)",
            "dir=in", "action=allow", $"program={Environment.ProcessPath}", "protocol=TCP", $"localport={port}",
            "remoteip=fd7a:115c:a1e0::/48", "profile=any", "enable=yes");
    }

    private static int RemoveFirewallRules()
    {
        RunNetshIgnoringFailure("advfirewall", "firewall", "delete", "rule", "name=Neural Chat (LAN and Tailscale IPv4)");
        RunNetshIgnoringFailure("advfirewall", "firewall", "delete", "rule", "name=Neural Chat (Tailscale IPv6)");
        return 0;
    }

    private static void RunNetsh(params string[] arguments)
    {
        using Process process = CreateNetsh(arguments);
        process.Start();
        process.WaitForExit();
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"Windows Firewall configuration failed: {process.StandardError.ReadToEnd()}");
    }

    private static void RunNetshIgnoringFailure(params string[] arguments)
    {
        try { RunNetsh(arguments); } catch { }
    }

    private static Process CreateNetsh(string[] arguments)
    {
        var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "netsh.exe"))
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
        };
        foreach (string argument in arguments) start.ArgumentList.Add(argument);
        return new Process { StartInfo = start };
    }

    private static void ServiceMain(int argc, IntPtr argv)
    {
        statusHandle = RegisterServiceCtrlHandler("NeuralChat", handler!);
        if (statusHandle == IntPtr.Zero) return;
        SetState(ServiceStartPending, 0, 15000);
        try
        {
            SetState(ServiceRunning, ServiceAcceptStop, 0);
            RunAsync().GetAwaiter().GetResult();
            SetState(ServiceStopped, 0, 0);
        }
        catch (Exception ex)
        {
            WriteLog(ex.ToString());
            SetState(ServiceStopped, 0, 0, 1);
        }
    }

    private static void ControlHandler(int control)
    {
        if (control != ServiceControlStop) return;
        SetState(ServiceStopPending, 0, 10000);
        StopSource.Cancel();
    }

    private static async Task RunAsync()
    {
        var config = HostingConfig.Load(options!.ConfigPath);
        // The service runs as LocalSystem, so refreshing here keeps Windows
        // Firewall synchronized after an administrator edits app-config.json.
        if (!consoleMode) UpdateFirewallRules(config.Port);
        int internalPort = FindFreePort();
        StartNode(internalPort);
        try
        {
            await WaitForNodeAsync(internalPort, StopSource.Token);
            var listener = new TcpListener(IPAddress.IPv6Any, config.Port);
            listener.Server.DualMode = true;
            listener.Start(512);
            WriteLog($"Listening on port {config.Port}; access mode {config.AccessMode}; internal port {internalPort}.");
            using var registration = StopSource.Token.Register(listener.Stop);
            while (!StopSource.IsCancellationRequested)
            {
                TcpClient client;
                try { client = await listener.AcceptTcpClientAsync(StopSource.Token); }
                catch (OperationCanceledException) { break; }
                catch (SocketException) when (StopSource.IsCancellationRequested) { break; }
                _ = HandleClientAsync(client, internalPort, config.AccessMode, StopSource.Token);
            }
        }
        finally
        {
            StopNode();
        }
    }

    private static async Task HandleClientAsync(TcpClient client, int internalPort, string accessMode, CancellationToken token)
    {
        using (client)
        {
            var remote = ((IPEndPoint?)client.Client.RemoteEndPoint)?.Address;
            if (remote is null || !AccessPolicy.IsAllowed(remote, accessMode))
            {
                WriteLog($"Rejected connection from {remote}.");
                return;
            }
            using var upstream = new TcpClient(AddressFamily.InterNetwork);
            try
            {
                await upstream.ConnectAsync(IPAddress.Loopback, internalPort, token);
                using NetworkStream incoming = client.GetStream();
                using NetworkStream outgoing = upstream.GetStream();
                Task a = incoming.CopyToAsync(outgoing, token);
                Task b = outgoing.CopyToAsync(incoming, token);
                await Task.WhenAny(a, b);
            }
            catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException) { }
        }
    }

    private static void StartNode(int internalPort)
    {
        string nodePath = Path.Combine(options!.AppDirectory, "node.exe");
        string serverPath = Path.Combine(options.AppDirectory, "app", "server.js");
        var start = new ProcessStartInfo(nodePath)
        {
            WorkingDirectory = Path.Combine(options.AppDirectory, "app"),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        start.ArgumentList.Add(serverPath);
        start.Environment["NODE_ENV"] = "production";
        start.Environment["HOSTNAME"] = "127.0.0.1";
        start.Environment["PORT"] = internalPort.ToString();
        start.Environment["NEURAL_CHAT_DATA_DIR"] = options.DataDirectory;
        start.Environment["NEURAL_CHAT_SERVER_CONFIG"] = options.ConfigPath;
        start.Environment["NEURAL_CHAT_PYTHON"] = Path.Combine(options.AppDirectory, "app", ".python", "python.exe");
        node = Process.Start(start) ?? throw new InvalidOperationException("Unable to start the bundled Node.js runtime.");
        node.OutputDataReceived += (_, e) => { if (e.Data is not null) WriteLog("node: " + e.Data); };
        node.ErrorDataReceived += (_, e) => { if (e.Data is not null) WriteLog("node: " + e.Data); };
        node.BeginOutputReadLine();
        node.BeginErrorReadLine();
    }

    private static async Task WaitForNodeAsync(int port, CancellationToken token)
    {
        for (int i = 0; i < 150; i++)
        {
            if (node?.HasExited == true) throw new InvalidOperationException($"Node.js exited during startup with code {node.ExitCode}.");
            using var probe = new TcpClient();
            try { await probe.ConnectAsync(IPAddress.Loopback, port, token); return; }
            catch (SocketException) { await Task.Delay(100, token); }
        }
        throw new TimeoutException("Neural Chat did not start within 15 seconds.");
    }

    private static void StopNode()
    {
        if (node is null || node.HasExited) return;
        try { node.Kill(entireProcessTree: true); node.WaitForExit(5000); } catch { }
    }

    private static int FindFreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static void WriteLog(string message)
    {
        string line = $"{DateTimeOffset.Now:O} {message}";
        try { log?.WriteLine(line); } catch { }
        if (Environment.UserInteractive) Console.WriteLine(line);
    }

    private static void SetState(int state, int accepted, int waitHint, int exitCode = 0)
    {
        var status = new ServiceStatus
        {
            ServiceType = ServiceWin32OwnProcess,
            CurrentState = state,
            ControlsAccepted = accepted,
            Win32ExitCode = exitCode,
            WaitHint = waitHint,
        };
        SetServiceStatus(statusHandle, ref status);
    }

    private sealed record ServiceOptions(string AppDirectory, string ConfigPath, string DataDirectory)
    {
        public static ServiceOptions Parse(string[] args)
        {
            static string Required(string[] values, string name)
            {
                int index = Array.FindIndex(values, x => x.Equals(name, StringComparison.OrdinalIgnoreCase));
                if (index < 0 || index + 1 >= values.Length) throw new ArgumentException($"Missing {name}.");
                return Path.GetFullPath(values[index + 1]);
            }
            string appDirectory = Path.GetDirectoryName(Environment.ProcessPath)
                ?? throw new InvalidOperationException("Unable to locate the service installation directory.");
            return new(Path.GetFullPath(appDirectory), Required(args, "--config"), Required(args, "--data"));
        }
    }

    private sealed record HostingConfig(int Port, string AccessMode)
    {
        public static HostingConfig Load(string path)
        {
            using JsonDocument doc = JsonDocument.Parse(File.ReadAllText(path));
            JsonElement server = doc.RootElement.GetProperty("server");
            int port = server.GetProperty("port").GetInt32();
            string mode = server.TryGetProperty("accessMode", out var value) ? value.GetString() ?? "" : "lan-and-tailscale";
            if (port is < 1 or > 65535 || mode is not ("lan" or "tailscale" or "lan-and-tailscale"))
                throw new InvalidDataException("app-config.json contains invalid server.port or server.accessMode.");
            return new(port, mode);
        }
    }

    private static class AccessPolicy
    {
        public static bool IsAllowed(IPAddress address, string mode)
        {
            if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
            if (IPAddress.IsLoopback(address)) return true;
            bool tailscale = InPrefix(address, IPAddress.Parse("100.64.0.0"), 10) || InPrefix(address, IPAddress.Parse("fd7a:115c:a1e0::"), 48);
            if (tailscale) return mode is "tailscale" or "lan-and-tailscale";
            return mode is "lan" or "lan-and-tailscale" ? IsOnLocalSubnet(address) : false;
        }

        private static bool IsOnLocalSubnet(IPAddress remote)
        {
            foreach (NetworkInterface adapter in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (adapter.OperationalStatus != OperationalStatus.Up || adapter.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                string identity = adapter.Name + " " + adapter.Description;
                if (identity.Contains("tailscale", StringComparison.OrdinalIgnoreCase)) continue;
                foreach (UnicastIPAddressInformation local in adapter.GetIPProperties().UnicastAddresses)
                {
                    IPAddress localAddress = local.Address;
                    if (localAddress.IsIPv4MappedToIPv6) localAddress = localAddress.MapToIPv4();
                    if (localAddress.AddressFamily != remote.AddressFamily) continue;
                    if (InPrefix(remote, localAddress, local.PrefixLength)) return true;
                }
            }
            return false;
        }

        private static bool InPrefix(IPAddress address, IPAddress network, int prefixLength)
        {
            byte[] a = address.GetAddressBytes();
            byte[] n = network.GetAddressBytes();
            if (a.Length != n.Length || prefixLength < 0 || prefixLength > a.Length * 8) return false;
            int fullBytes = prefixLength / 8;
            int remainingBits = prefixLength % 8;
            for (int i = 0; i < fullBytes; i++) if (a[i] != n[i]) return false;
            if (remainingBits == 0) return true;
            int mask = 0xff << (8 - remainingBits);
            return (a[fullBytes] & mask) == (n[fullBytes] & mask);
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ServiceTableEntry { public string? ServiceName; public ServiceMainDelegate? ServiceMain; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus
    {
        public int ServiceType, CurrentState, ControlsAccepted, Win32ExitCode, ServiceSpecificExitCode, CheckPoint, WaitHint;
    }
    private delegate void ServiceMainDelegate(int argc, IntPtr argv);
    private delegate void ServiceControlHandler(int control);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool StartServiceCtrlDispatcher([In] ServiceTableEntry[] serviceTable);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr RegisterServiceCtrlHandler(string serviceName, ServiceControlHandler callback);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetServiceStatus(IntPtr handle, ref ServiceStatus status);
}
