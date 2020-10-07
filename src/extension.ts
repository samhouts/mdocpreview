import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('mdocPreview.start', () => {
			MdocPreviewPanel.createOrShow(context.extensionPath, context.storagePath);
		})
	);

	vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
		MdocPreviewPanel.update();
	});

	if (vscode.window.registerWebviewPanelSerializer) {
		// Make sure we register a serializer in activation event
		vscode.window.registerWebviewPanelSerializer(MdocPreviewPanel.viewType, {
			async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
				console.log(`Got state: ${state}`);
				MdocPreviewPanel.revive(webviewPanel, context.extensionPath, context.storagePath);
			}
		});
	}
}

class MdocPreviewPanel {
	public static currentPanel: MdocPreviewPanel | undefined;

	public static readonly viewType = 'mdocPreview';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionPath: string;
	private readonly _storagePath: string | undefined;
	private _disposables: vscode.Disposable[] = [];

	public static createOrShow(extensionPath: string, storagePath: string | undefined) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If we already have a panel, show it.
		if (MdocPreviewPanel.currentPanel) {
			MdocPreviewPanel.currentPanel._panel.reveal(column);
			MdocPreviewPanel.currentPanel._update();
			return;
		}

		// Otherwise, create a new panel.
		const panel = vscode.window.createWebviewPanel(
			MdocPreviewPanel.viewType,
			'mdoc Preview',
			vscode.ViewColumn.Beside,
			{
				// Enable javascript in the webview
				enableScripts: true,

				// And restrict the webview to only loading content from our extension's `styles` directory.
				localResourceRoots: [vscode.Uri.file(path.join(extensionPath, 'styles'))]
			}
		);

		MdocPreviewPanel.currentPanel = new MdocPreviewPanel(panel, extensionPath, storagePath);
	}

	public dispose() {
		MdocPreviewPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	public static revive(panel: vscode.WebviewPanel, extensionPath: string, storagePath: string | undefined) {
		MdocPreviewPanel.currentPanel = new MdocPreviewPanel(panel, extensionPath, storagePath);
	}

	public static update() {
		if (!MdocPreviewPanel.currentPanel) {
			return;
		}
		MdocPreviewPanel.currentPanel._update();
	}

	private constructor(panel: vscode.WebviewPanel, extensionPath: string, storagePath: string | undefined) {
		this._panel = panel;
		this._extensionPath = extensionPath;
		this._storagePath = storagePath;

		// Set the webview's initial html content
		this._update();

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Update the content based on view changes
		this._panel.onDidChangeViewState(
			e => {
				if (this._panel.visible) {
					this._update();
				}
			},
			null,
			this._disposables
		);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'alert':
						vscode.window.showErrorMessage(message.text);
						return;
				}
			},
			null,
			this._disposables
		);
	}

	private _update() {

		let editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		let doc = editor.document.getText();

		const webview = this._panel.webview;
		const extensionPath = this._extensionPath;

		const outputPath = this._storagePath ? this._storagePath : '';

		fs.mkdir(path.join(outputPath, "Preview"), function () {

			const sourcePath = path.join(outputPath, "Preview", "PreviewFile.xml");

			fs.writeFile(sourcePath, doc, function () {

				const index = "<Overview><Types><Namespace Name=\"Preview\"><Type Name=\"PreviewFile\" Kind=\"Class\"/></Namespace></Types></Overview>";
				fs.writeFile(path.join(outputPath, "index.xml"), index, 'utf8', function () {

					const ns = "<Namespace Name=\"Preview\"></Namespace>";
					fs.writeFile(path.join(outputPath, "ns-Preview.xml"), ns, 'utf8', function () {

						const mdocPath = path.join(extensionPath, 'mdoc', 'mdoc.exe');
						const templatePath = path.join(extensionPath, 'mdoc', 'doctemplate.xsl');
						const cp = require('child_process');
						cp.exec(mdocPath + ' export-html --template ' + templatePath + ' --force-update --debug --o ' + outputPath + '\\html ' + outputPath, (err: object, stdout: object, stderr: object) => {

							if (err) {
								vscode.window.showErrorMessage("mdoc Preview tried to load, but something went wrong!");
								console.log('err: ' + err);
								return;
							}

							console.log('stdout: ' + stdout);
							console.log('stderr: ' + stderr);

							fs.readFile(path.join(outputPath, 'html', 'Preview', "PreviewFile.html"), 'utf8', function (err, data) {

								const stylesPathOnDisk = vscode.Uri.file(path.join(extensionPath, 'styles', 'styles.css'));
								const stylesUri = webview.asWebviewUri(stylesPathOnDisk);

								webview.html = data.replace('$stylesUri', stylesUri.toString());

								vscode.window.showInformationMessage('mdoc Preview Updated!');
							});
						});
					});
				});
			});
		});
	}

}