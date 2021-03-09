import * as vscode from 'vscode';
import { CommandLine as ParsedCommandLine } from './node';
import { CommandLineHistory } from '../history/historyFile';
import { Mode } from './../mode/mode';
import { Logger } from '../util/logger';
import { StatusBar } from '../statusBar';
import { VimError, ErrorCode } from '../error';
import { VimState } from '../state/vimState';
import { configuration } from '../configuration/configuration';
import { Register } from '../register/register';
import { RecordedState } from '../state/recordedState';

type ParseFunc = (input: string) => ParsedCommandLine;

class CommandLine {
  private _history: CommandLineHistory;
  private readonly _logger = Logger.get('CommandLine');
  public parseFn: ParseFunc | undefined = undefined;

  /**
   *  Index used for navigating commandline history with <up> and <down>
   */
  public commandLineHistoryIndex: number = 0;

  /**
   * for checking the last pressed key in command mode
   */
  public lastKeyPressed = '';

  public autoCompleteIndex = 0;
  public autoCompleteItems: string[] = [];
  public preCompleteCharacterPos = 0;
  public preCompleteCommand = '';

  public get historyEntries() {
    return this._history?.get() || [];
  }

  public previousMode = Mode.Normal;

  public async load(context: vscode.ExtensionContext): Promise<void> {
    this._history = new CommandLineHistory(context);
    return this._history.load();
  }

  public async Run(command: string, vimState: VimState): Promise<void> {
    if (!command || command.length === 0) {
      return;
    }

    if (command.startsWith(':')) {
      command = command.slice(1);
    }

    this._history.add(command);
    this.commandLineHistoryIndex = this._history.get().length;

    if (!command.startsWith('reg')) {
      const recState = new RecordedState();
      recState.registerName = ':';
      recState.commandList = command.split('');
      Register.putByKey(recState, ':', undefined, true);
    }

    try {
      const cmd = this.parseFn!(command);
      const useNeovim = configuration.enableNeovim && cmd.command && cmd.command.neovimCapable();

      if (useNeovim && vimState.nvim) {
        const { statusBarText, error } = await vimState.nvim.run(vimState, command);
        StatusBar.setText(vimState, statusBarText, error);
      } else {
        await cmd.execute(vimState);
      }
    } catch (e) {
      if (e instanceof VimError) {
        if (
          e.code === ErrorCode.NotAnEditorCommand &&
          configuration.enableNeovim &&
          vimState.nvim
        ) {
          const { statusBarText } = await vimState.nvim.run(vimState, command);
          StatusBar.setText(vimState, statusBarText, true);
        } else {
          StatusBar.setText(vimState, e.toString(), true);
        }
      } else {
        this._logger.error(`Error executing cmd=${command}. err=${e}.`);
      }
    }
  }

  /**
   * Prompts the user for a command using an InputBox, and runs the provided command
   */
  public async PromptAndRun(initialText: string, vimState: VimState): Promise<void> {
    const cmd = await vscode.window.showInputBox(this.getInputBoxOptions(initialText));
    await this.Run(cmd!, vimState);
  }

  private getInputBoxOptions(text: string): vscode.InputBoxOptions {
    return {
      prompt: 'Vim command line',
      value: text,
      ignoreFocusOut: false,
      valueSelection: [text.length, text.length],
    };
  }

  public async showHistory(initialText: string): Promise<string | undefined> {
    this._history.add(initialText);

    return vscode.window.showQuickPick(this._history.get().slice().reverse(), {
      placeHolder: 'Vim command history',
      ignoreFocusOut: false,
    });
  }
}

export const commandLine = new CommandLine();
