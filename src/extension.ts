// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { exec } from 'child_process';

type SerialPortInfo = {
    path: string;
    manufacturer?: string;
};

enum LogLevel {
    info = "info",
    verbose = "verbose",
    debug = "debug",
    silly = "silly"
}

const DEFAULT_PORT = "17531";

class JaculusInterface {
    private selectComPortBtn: vscode.StatusBarItem | null = null;
    private selectedPort: string | null = null;
    private selectedSocket: string | null = null;
    private terminalJaculus: vscode.Terminal | null = null;
    private debugMode: LogLevel = LogLevel.info;
    private monitoring: boolean = false;

    constructor(private context: vscode.ExtensionContext, private extensionPath: string, private jacToolCommand: string) {
        this.selectedPort = this.context.globalState.get("selectedPort") || null; // if port is selected from previous session, find it
        this.debugMode = this.context.globalState.get("debugMode") || LogLevel.info; // if debug mode is selected from previous session, find it
        this.terminalJaculus = vscode.window.terminals.find(terminal => terminal.name === 'Jaculus') || null; // if terminal is opened from previous session, find it
        vscode.window.onDidCloseTerminal((closedTerminal) => {
            if (this.terminalJaculus === closedTerminal) {
                this.terminalJaculus = null;
            }
        });
    }

    private async selectComPort() {
        exec(`${this.jacToolCommand} list-ports`, (error, stdout) => {
            if (error) {
                vscode.window.showErrorMessage(`Error: ${error.message}`);
                return;
            }
            let ports = this.parseSerialPorts(stdout);
            let items = ports.map(port => ({ label: port.path, description: port.manufacturer }));
            items.push({ label: "Socket", description: undefined });
            vscode.window.showQuickPick(items).then(async selected => {
                if (selected) {
                    if (selected.label === "Socket") {
                        const socketTmp = await vscode.window.showInputBox({
                            placeHolder: 'Enter ip and port of your jaculus device',
                            prompt: `IP:PORT (default port: ${DEFAULT_PORT})`,
                            validateInput: (text: string): string | undefined => {
                                if (text.trim().length === 0) {
                                    return 'Input cannot be empty';
                                }
                                return undefined;
                            }
                        });
                        let socket = null;

                        if (socketTmp?.includes(":")) {
                            socket = socketTmp;
                        }
                        else if (socketTmp !== undefined) {
                            socket = socketTmp + `:${DEFAULT_PORT}`;
                        }

                        this.selectedPort = null;
                        this.context.globalState.update("selectedPort", this.selectedPort);

                        this.selectedSocket = socket ? null : socket;
                        this.context.globalState.update("selectedSocket", this.selectedSocket);
                        this.selectComPortBtn && (this.selectComPortBtn.text = `$(plug) Socket: ${this.selectedSocket}`);
                        vscode.window.showInformationMessage(`Selected Socket: ${this.selectedSocket}`);
                    }
                    else {
                        this.selectedSocket = null;
                        this.context.globalState.update("selectedSocket", this.selectedSocket);

                        this.selectedPort = selected.label;
                        this.context.globalState.update("selectedPort", this.selectedPort);
                        this.selectComPortBtn && (this.selectComPortBtn.text = `$(plug) ${this.selectedPort.replace('/dev/tty.', '')}`);
                        vscode.window.showInformationMessage(`Selected COM port: ${selected.label}`);
                    }
                }
            });
        });
    }

    public async build() {
        vscode.workspace.saveAll(false);
        this.runJaculusCommandInTerminal('build', [], this.extensionPath);
    }

    public async flash() {
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('flash', port, this.extensionPath);
    }

    public async monitor() {
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('monitor', port, this.extensionPath);
    }

    public async buildFlashMonitor() {
        vscode.workspace.saveAll(false);
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('build flash monitor', port, this.extensionPath);

        this.monitoring = true;
    }

    public async monitorStop() {
        if (this.terminalJaculus && this.monitoring) {
            this.terminalJaculus.sendText(String.fromCharCode(3), true);
            this.monitoring = false;
        }
    }

    private async start() {
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('start', port, this.extensionPath);
    }

    private async stop() {
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('stop', port, this.extensionPath);
    }

    private async showVersion() {
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('version', port, this.extensionPath);
    }

    private async showStatus() {
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('status', port, this.extensionPath);
    }

    private async format() {
        const port = this.getConnectedPort();
        await this.stopRunningMonitor();
        this.runJaculusCommandInTerminal('format', port, this.extensionPath);
    }

    private async runJaculusCommandInTerminal(command: string, args: string[], cwd: string): Promise<void> {
        if (this.terminalJaculus === null) {
            this.terminalJaculus = vscode.window.createTerminal({
                name: 'Jaculus',
                // shellPath: cwd,
                message: 'Jaculus Terminal',
                iconPath: new vscode.ThemeIcon('gear'),
            });
        }

        if (this.debugMode !== LogLevel.info) {
            const str: string = LogLevel[this.debugMode];
            args.push('--log-level', str);
        }

        this.terminalJaculus.show();
        this.terminalJaculus.sendText(`${this.jacToolCommand} ${command} ${args.join(' ')}`, true);
    }

    private async selectLogLevel() {
        let items = Object.keys(LogLevel);
        vscode.window.showQuickPick(items).then(selected => {
            if (selected) {
                this.debugMode = LogLevel[selected as keyof typeof LogLevel];
            }
        });
    }

    private getConnectedPort(): string[] {
        if (this.selectedPort !== null) {
            return ["--port", this.selectedPort!];
        }
        if (this.selectedSocket !== null) {
            return ["--socket", this.selectedSocket!];
        }

        vscode.window.showErrorMessage('Jaculus: No COM port or Socket selected');
        throw new Error('Jaculus: No COM port or Socket selected');
    }

    private async stopRunningMonitor() {
        if (this.monitoring) {
            this.monitorStop();
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }


    private parseSerialPorts(input: string): SerialPortInfo[] {
        const result: SerialPortInfo[] = [];
        const lines = input.split('\n');

        // Start parsing from line 2 to skip headers
        for (let i = 2; i < lines.length; i++) {
          const line = lines[i].trim();

          if (line === 'Done') {
            break;
          }

          // Ignore empty lines
          if (line.length > 0) {
            const parts = line.split(/\s\s+/); // split on 2 or more spaces
            const path = parts[0];
            const manufacturer = parts.length > 1 ? parts[1] : undefined;
            result.push({ path, manufacturer });
          }
        }
        return result;
    }

    private async checkJaculusInstalled(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            exec(this.jacToolCommand, (err) => {
                if (err) {
                    resolve(false);
                }
                resolve(true);
            });
        });
    }

    private async checkForUpdates(showIfUpToDate: boolean = false) {
        exec('npm outdated -g jaculus-tools', async (error, stdout) => {
            if (stdout) {
                const update = await vscode.window.showWarningMessage('jaculus-tools is outdated. Do you want to update now?', 'Yes', 'No');
                if (update === 'Yes') {
                    this.updateJaculusTools();
                }
            } else if (showIfUpToDate) {
                vscode.window.showInformationMessage('jaculus-tools is up to date!');
            }
        });
    }

    private updateJaculusTools() {
        exec('npm install -g jaculus-tools', (error, stdout) => {
            if (error) {
                vscode.window.showErrorMessage(`Error: ${error.message}`);
                return;
            }
            vscode.window.showInformationMessage('jaculus-tools was successfully updated!');
        });
    }


    public async registerCommands() {
        if (!await this.checkJaculusInstalled()) {
            vscode.window.showErrorMessage('The "jac" command does not seem to be installed. Please visit https://www.jaculus.org for installation instructions.');
            return;
        }

        const color = "#ff8500";

        this.selectComPortBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.selectComPortBtn.command = "jaculus.SelectComPort";
        this.selectComPortBtn.text = this.selectedPort ? `$(plug) ${this.selectedPort.replace('/dev/tty.', '')}` : "$(plug) Select COM Port";
        this.selectComPortBtn.tooltip = "Jaculus Select COM Port";
        this.selectComPortBtn.color = color;
        this.selectComPortBtn.show();

        let buildBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        buildBtn.command = "jaculus.Build";
        buildBtn.text = "$(database) Build";
        buildBtn.tooltip = "Jaculus Build";
        buildBtn.color = color;
        buildBtn.show();

        let flashBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        flashBtn.command = "jaculus.Flash";
        flashBtn.text = "$(zap) Flash";
        flashBtn.tooltip = "Jaculus Flash";
        flashBtn.color = color;
        flashBtn.show();

        let monitorBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        monitorBtn.command = "jaculus.Monitor";
        monitorBtn.text = "$(device-desktop) Monitor";
        monitorBtn.tooltip = "Jaculus Monitor";
        monitorBtn.color = color;
        monitorBtn.show();

        let buildFlashMonitorBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        buildFlashMonitorBtn.command = "jaculus.BuildFlashMonitor";
        buildFlashMonitorBtn.text = "$(diff-renamed) Build, Flash and Monitor";
        buildFlashMonitorBtn.tooltip = "Jaculus Build, Flash and Monitor";
        buildFlashMonitorBtn.color = color;
        buildFlashMonitorBtn.show();

        this.context.subscriptions.push(
            vscode.commands.registerCommand('jaculus.SelectComPort', () => this.selectComPort()),
            vscode.commands.registerCommand('jaculus.Build', () => this.build() ),
            vscode.commands.registerCommand('jaculus.Flash', () => this.flash() ),
            vscode.commands.registerCommand('jaculus.Monitor', () => this.monitor()),
            vscode.commands.registerCommand('jaculus.BuildFlashMonitor', () => this.buildFlashMonitor()),
            vscode.commands.registerCommand('jaculus.SetLogLevel', () => this.selectLogLevel()),
            vscode.commands.registerCommand('jaculus.Start', () => this.start()),
            vscode.commands.registerCommand('jaculus.Stop', () => this.stop()),
            vscode.commands.registerCommand('jaculus.ShowVersion', () => this.showVersion()),
            vscode.commands.registerCommand('jaculus.ShowStatus', () => this.showStatus()),
            vscode.commands.registerCommand('jaculus.Format', () => this.format()),
            vscode.commands.registerCommand('jaculus.CheckForUpdates', () => this.checkForUpdates(true))
        );

        this.checkForUpdates();
    }
}


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "jaculus" is now active!');

    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        const path = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const jaculus = new JaculusInterface(context, path, 'npx jac');
        await jaculus.registerCommands();
    } else {
        // vscode.window.showErrorMessage('Jaculus: No workspace folder found');
    }
}

// This method is called when your extension is deactivated
export function deactivate() { }
