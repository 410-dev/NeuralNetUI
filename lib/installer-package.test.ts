import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("Windows installer suppresses system restarts", async () => {
  const source = await readFile(path.join(process.cwd(), "installer", "Product.wxs"), "utf8");
  assert.match(source, /<Property Id="REBOOT" Value="ReallySuppress" Secure="yes"\s*\/>/);
  assert.match(source, /<Property Id="REBOOTPROMPT" Value="Suppress" Secure="yes"\s*\/>/);
  assert.doesNotMatch(source, /<(?:ForceReboot|ScheduleReboot)\b/);
});

test("the supplied NeuralNetUI artwork drives the favicon and tray icon", async () => {
  const root = process.cwd();
  const [sourcePng, favicon, trayIco, trayProject, traySource] = await Promise.all([
    readFile(path.join(root, "neuralnetui.png")),
    readFile(path.join(root, "app", "icon.png")),
    readFile(path.join(root, "installer", "tray-host", "neuralnetui.ico")),
    readFile(path.join(root, "installer", "tray-host", "NeuralNetUI.Tray.csproj"), "utf8"),
    readFile(path.join(root, "installer", "tray-host", "Program.cs"), "utf8"),
  ]);

  assert.deepEqual(favicon, sourcePng);
  assert.equal(trayIco.readUInt16LE(0), 0);
  assert.equal(trayIco.readUInt16LE(2), 1);
  assert.ok(trayIco.readUInt16LE(4) >= 6, "the tray ICO should contain multiple display sizes");
  assert.match(trayProject, /<ApplicationIcon>neuralnetui\.ico<\/ApplicationIcon>/);
  assert.match(trayProject, /<EmbeddedResource Include="neuralnetui\.ico" LogicalName="NeuralNetUI\.Tray\.neuralnetui\.ico"\s*\/>/);
  assert.match(traySource, /GetManifestResourceStream\("NeuralNetUI\.Tray\.neuralnetui\.ico"\)/);
  assert.doesNotMatch(traySource, /SystemIcons\.Application/);
});
