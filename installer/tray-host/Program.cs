using System.ComponentModel;
using System.Diagnostics;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;

namespace NeuralNetUI.Tray;

internal static class Program
{
    private const string ServiceName = "NeuralChat";
    private const int ScManagerConnect = 0x0001;
    private const int ServiceQueryStatus = 0x0004;
    private const int ServiceStart = 0x0010;
    private const int ServiceStop = 0x0020;
    private const int ServiceStopped = 0x00000001;
    private const int ServiceStartPending = 0x00000002;
    private const int ServiceStopPending = 0x00000003;
    private const int ServiceRunning = 0x00000004;
    private const int ScStatusProcessInfo = 0;
    private const int ServiceControlStop = 0x00000001;
    private const int ErrorServiceAlreadyRunning = 1056;
    private const int ErrorServiceNotActive = 1062;

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 2 && args[0].Equals("--elevated-service", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                ChangeServiceState(args[1]);
                return 0;
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "NeuralNetUI", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        string userId = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
        string instanceName = $"Local\\NeuralNetUI.Tray.{userId}";
        string openEventName = $"Local\\NeuralNetUI.Open.{userId}";
        using var mutex = new Mutex(initiallyOwned: true, instanceName, out bool isFirstInstance);
        if (!isFirstInstance)
        {
            for (int attempt = 0; attempt < 10; attempt++)
            {
                try
                {
                    EventWaitHandle.OpenExisting(openEventName).Set();
                    break;
                }
                catch (WaitHandleCannotBeOpenedException) { Thread.Sleep(50); }
            }
            return 0;
        }

        ApplicationConfiguration.Initialize();
        using var openEvent = new EventWaitHandle(false, EventResetMode.AutoReset, openEventName);
        using var context = new TrayApplicationContext(openEvent);
        Application.Run(context);
        return 0;
    }

    private sealed class TrayApplicationContext : ApplicationContext
    {
        private readonly NotifyIcon trayIcon;
        private readonly EventWaitHandle openEvent;
        private readonly System.Windows.Forms.Timer requestTimer;
        private readonly ToolStripMenuItem openItem;
        private readonly ToolStripMenuItem settingsItem;
        private readonly ToolStripMenuItem restartItem;
        private readonly ToolStripMenuItem exitItem;
        private bool busy;
        private bool initialOpen = true;

        public TrayApplicationContext(EventWaitHandle openEvent)
        {
            this.openEvent = openEvent;
            openItem = new ToolStripMenuItem("Web UI 열기", null, async (_, _) => await OpenUiAsync());
            settingsItem = new ToolStripMenuItem("설정 파일 수정", null, (_, _) => EditSettings());
            restartItem = new ToolStripMenuItem("재시작", null, async (_, _) => await RestartAsync());
            exitItem = new ToolStripMenuItem("종료하기", null, async (_, _) => await ExitAsync());

            var menu = new ContextMenuStrip();
            menu.Items.Add(openItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(settingsItem);
            menu.Items.Add(restartItem);
            menu.Items.Add(exitItem);

            trayIcon = new NotifyIcon
            {
                Icon = SystemIcons.Application,
                Text = "NeuralNetUI",
                ContextMenuStrip = menu,
                Visible = true,
            };
            trayIcon.DoubleClick += async (_, _) => await OpenUiAsync();

            requestTimer = new System.Windows.Forms.Timer { Interval = 250 };
            requestTimer.Tick += async (_, _) =>
            {
                if (initialOpen || openEvent.WaitOne(0))
                {
                    initialOpen = false;
                    await OpenUiAsync();
                }
            };
            requestTimer.Start();
        }

        private async Task OpenUiAsync()
        {
            if (!BeginOperation()) return;
            try
            {
                await EnsureServiceRunningAsync();
                int port = ReadConfiguredPort();
                await WaitForServerAsync(port, TimeSpan.FromSeconds(30));
                Process.Start(new ProcessStartInfo($"http://localhost:{port}") { UseShellExecute = true });
            }
            catch (Exception error)
            {
                ShowError(error);
            }
            finally
            {
                EndOperation();
            }
        }

        private void EditSettings()
        {
            try
            {
                string configPath = GetConfigPath();
                var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "notepad.exe"))
                {
                    Arguments = $"\"{configPath}\"",
                    UseShellExecute = true,
                    Verb = "runas",
                };
                Process.Start(start);
            }
            catch (Win32Exception error) when (error.NativeErrorCode == 1223) { }
            catch (Exception error) { ShowError(error); }
        }

        private async Task RestartAsync()
        {
            if (!BeginOperation()) return;
            try
            {
                await RunElevatedServiceActionAsync("restart");
                int port = ReadConfiguredPort();
                await WaitForServerAsync(port, TimeSpan.FromSeconds(30));
                trayIcon.ShowBalloonTip(2500, "NeuralNetUI", "서비스를 다시 시작했습니다.", ToolTipIcon.Info);
            }
            catch (Win32Exception error) when (error.NativeErrorCode == 1223) { }
            catch (Exception error) { ShowError(error); }
            finally { EndOperation(); }
        }

        private async Task ExitAsync()
        {
            if (busy) return;
            if (MessageBox.Show(
                    "NeuralNetUI 서비스와 트레이 프로그램을 종료할까요?\n시작 메뉴의 NeuralNetUI를 누르면 다시 실행할 수 있습니다.",
                    "NeuralNetUI",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question) != DialogResult.Yes)
                return;

            if (!BeginOperation()) return;
            try
            {
                await RunElevatedServiceActionAsync("stop");
                trayIcon.Visible = false;
                ExitThread();
            }
            catch (Win32Exception error) when (error.NativeErrorCode == 1223) { }
            catch (Exception error) { ShowError(error); }
            finally { EndOperation(); }
        }

        private bool BeginOperation()
        {
            if (busy) return false;
            busy = true;
            openItem.Enabled = settingsItem.Enabled = restartItem.Enabled = exitItem.Enabled = false;
            return true;
        }

        private void EndOperation()
        {
            busy = false;
            openItem.Enabled = settingsItem.Enabled = restartItem.Enabled = exitItem.Enabled = true;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                requestTimer.Stop();
                requestTimer.Dispose();
                trayIcon.Visible = false;
                trayIcon.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    private static async Task EnsureServiceRunningAsync()
    {
        if (GetServiceState() == ServiceRunning) return;
        try
        {
            ChangeServiceState("start");
        }
        catch (Win32Exception error) when (error.NativeErrorCode == 5)
        {
            await RunElevatedServiceActionAsync("start");
        }
    }

    private static async Task RunElevatedServiceActionAsync(string action)
    {
        var start = new ProcessStartInfo(Environment.ProcessPath!)
        {
            Arguments = $"--elevated-service {action}",
            UseShellExecute = true,
            Verb = "runas",
        };
        using Process process = Process.Start(start) ?? throw new InvalidOperationException("관리자 권한 작업을 시작하지 못했습니다.");
        await process.WaitForExitAsync();
        if (process.ExitCode != 0) throw new InvalidOperationException($"서비스 {action} 작업이 실패했습니다.");
    }

    private static string GetConfigPath() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "Neural Chat",
        "app-config.json");

    private static int ReadConfiguredPort()
    {
        using JsonDocument document = JsonDocument.Parse(File.ReadAllText(GetConfigPath()));
        int port = document.RootElement.GetProperty("server").GetProperty("port").GetInt32();
        if (port is < 1 or > 65535) throw new InvalidDataException("설정 파일의 server.port 값이 올바르지 않습니다.");
        return port;
    }

    private static async Task WaitForServerAsync(int port, TimeSpan timeout)
    {
        Stopwatch timer = Stopwatch.StartNew();
        while (timer.Elapsed < timeout)
        {
            using var client = new TcpClient();
            try
            {
                await client.ConnectAsync("127.0.0.1", port);
                return;
            }
            catch (SocketException)
            {
                await Task.Delay(200);
            }
        }
        throw new TimeoutException($"NeuralNetUI가 {port} 포트에서 시작되지 않았습니다.");
    }

    private static void ChangeServiceState(string action)
    {
        if (action is not ("start" or "stop" or "restart"))
            throw new ArgumentException("알 수 없는 서비스 작업입니다.");

        IntPtr manager = OpenSCManager(null, null, ScManagerConnect);
        if (manager == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            IntPtr service = OpenService(manager, ServiceName, ServiceQueryStatus | ServiceStart | ServiceStop);
            if (service == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                if (action is "stop" or "restart") StopWindowsService(service);
                if (action is "start" or "restart") StartWindowsService(service);
            }
            finally { CloseServiceHandle(service); }
        }
        finally { CloseServiceHandle(manager); }
    }

    private static int GetServiceState()
    {
        IntPtr manager = OpenSCManager(null, null, ScManagerConnect);
        if (manager == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            IntPtr service = OpenService(manager, ServiceName, ServiceQueryStatus);
            if (service == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            try { return QueryState(service); }
            finally { CloseServiceHandle(service); }
        }
        finally { CloseServiceHandle(manager); }
    }

    private static void StartWindowsService(IntPtr service)
    {
        int state = QueryState(service);
        if (state == ServiceRunning) return;
        if (state == ServiceStartPending)
        {
            WaitForState(service, ServiceRunning, TimeSpan.FromSeconds(30));
            return;
        }
        if (state == ServiceStopPending) WaitForState(service, ServiceStopped, TimeSpan.FromSeconds(30));
        if (!StartService(service, 0, null))
        {
            int error = Marshal.GetLastWin32Error();
            if (error != ErrorServiceAlreadyRunning) throw new Win32Exception(error);
        }
        WaitForState(service, ServiceRunning, TimeSpan.FromSeconds(30));
    }

    private static void StopWindowsService(IntPtr service)
    {
        int state = QueryState(service);
        if (state == ServiceStopped) return;
        if (state == ServiceStopPending)
        {
            WaitForState(service, ServiceStopped, TimeSpan.FromSeconds(30));
            return;
        }
        if (state == ServiceStartPending) WaitForState(service, ServiceRunning, TimeSpan.FromSeconds(30));
        if (!ControlService(service, ServiceControlStop, out _))
        {
            int error = Marshal.GetLastWin32Error();
            if (error != ErrorServiceNotActive) throw new Win32Exception(error);
        }
        WaitForState(service, ServiceStopped, TimeSpan.FromSeconds(30));
    }

    private static void WaitForState(IntPtr service, int expected, TimeSpan timeout)
    {
        Stopwatch timer = Stopwatch.StartNew();
        while (timer.Elapsed < timeout)
        {
            if (QueryState(service) == expected) return;
            Thread.Sleep(200);
        }
        throw new TimeoutException("Windows 서비스 상태 변경 시간이 초과되었습니다.");
    }

    private static int QueryState(IntPtr service)
    {
        int size = Marshal.SizeOf<ServiceStatusProcess>();
        if (!QueryServiceStatusEx(service, ScStatusProcessInfo, out ServiceStatusProcess status, size, out _))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return status.CurrentState;
    }

    private static void ShowError(Exception error) => MessageBox.Show(error.Message, "NeuralNetUI", MessageBoxButtons.OK, MessageBoxIcon.Error);

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus
    {
        public int ServiceType;
        public int CurrentState;
        public int ControlsAccepted;
        public int Win32ExitCode;
        public int ServiceSpecificExitCode;
        public int CheckPoint;
        public int WaitHint;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatusProcess
    {
        public int ServiceType;
        public int CurrentState;
        public int ControlsAccepted;
        public int Win32ExitCode;
        public int ServiceSpecificExitCode;
        public int CheckPoint;
        public int WaitHint;
        public int ProcessId;
        public int ServiceFlags;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenSCManager(string? machineName, string? databaseName, int desiredAccess);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenService(IntPtr manager, string serviceName, int desiredAccess);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseServiceHandle(IntPtr handle);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool StartService(IntPtr service, int argumentCount, string[]? arguments);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ControlService(IntPtr service, int control, out ServiceStatus status);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryServiceStatusEx(
        IntPtr service,
        int infoLevel,
        out ServiceStatusProcess status,
        int bufferSize,
        out int bytesNeeded);
}
