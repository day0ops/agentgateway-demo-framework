import inquirer from 'inquirer';
import chalk from 'chalk';
import readline from 'readline';

/**
 * Base prompt utilities for interactive CLI
 * Provides generic prompt methods that can be used throughout the application
 */
export class Prompts {
  /**
   * Raw-mode list selector.
   * ↑/↓ to navigate, Enter to select, Esc/Backspace to go back (when allowBack is true).
   * @param {string} message - The prompt message
   * @param {Array} choices - List of choices (may include inquirer.Separator instances)
   * @param {object} opts
   * @param {boolean} opts.allowBack - Enable Esc/Backspace to trigger a "back" action
   * @param {number} opts.defaultIndex - Initial pointer position (index into selectable items)
   * @returns {Promise<{value: *, back: boolean}>}
   */
  static _rawSelect(message, choices, { allowBack = false, defaultIndex = 0 } = {}) {
    return new Promise(resolve => {
      const stdout = process.stdout;
      const stdin = process.stdin;

      if (!stdin.isTTY) {
        const first = choices.find(
          c => !(c instanceof inquirer.Separator) && c.type !== 'separator'
        );
        resolve({ value: first?.value ?? null, back: false });
        return;
      }

      const selectable = [];
      choices.forEach(c => {
        if (!(c instanceof inquirer.Separator) && c.type !== 'separator') {
          selectable.push(c);
        }
      });

      let pointer = Math.min(defaultIndex, selectable.length - 1);
      let linesRendered = 0;

      const render = () => {
        if (linesRendered > 0) {
          stdout.write(`\x1B[${linesRendered}A\x1B[0J`);
        }

        const lines = [];
        lines.push(
          chalk.green('?') +
            ' ' +
            chalk.bold(message) +
            chalk.yellow('  (enter/space to select' + (allowBack ? ', esc to go back' : '') + ')')
        );

        let itemIdx = 0;
        for (const choice of choices) {
          if (choice instanceof inquirer.Separator || choice.type === 'separator') {
            lines.push(chalk.dim(' ────────────────'));
          } else {
            const active = itemIdx === pointer;
            const prefix = active ? chalk.cyan('❯') : ' ';
            const label = active ? chalk.cyan(choice.name) : choice.name;
            lines.push(`${prefix} ${label}`);
            itemIdx++;
          }
        }

        stdout.write(lines.join('\n') + '\n');
        linesRendered = lines.length;
      };

      const finish = (value, back) => {
        if (linesRendered > 0) {
          stdout.write(`\x1B[${linesRendered}A\x1B[0J`);
        }
        if (!back) {
          const item = selectable[pointer];
          stdout.write(
            chalk.green('✔') +
              ' ' +
              chalk.bold(message) +
              ' ' +
              chalk.cyan(item?.short || item?.name || '') +
              '\n'
          );
        }
        stdout.write('\x1B[?25h');
        stdin.removeListener('keypress', onKeypress);
        stdin.setRawMode(false);
        stdin.pause();
        resolve({ value, back });
      };

      const onKeypress = (_ch, key) => {
        if (!key) return;

        if (key.name === 'up') {
          pointer = (pointer - 1 + selectable.length) % selectable.length;
          render();
        } else if (key.name === 'down') {
          pointer = (pointer + 1) % selectable.length;
          render();
        } else if (key.name === 'return' || key.name === 'space') {
          finish(selectable[pointer].value, false);
        } else if (allowBack && (key.name === 'escape' || key.name === 'backspace')) {
          finish(null, true);
        } else if (key.name === 'c' && key.ctrl) {
          stdout.write('\x1B[?25h');
          stdin.removeListener('keypress', onKeypress);
          stdin.setRawMode(false);
          stdin.pause();
          process.exit(0);
        }
      };

      readline.emitKeypressEvents(stdin);
      stdin.setRawMode(true);
      stdin.resume();
      stdout.write('\x1B[?25l');
      stdin.on('keypress', onKeypress);
      render();
    });
  }

  /**
   * Prompt user to select from a list of options
   * @param {string} message - The prompt message
   * @param {Array<{name: string, value: string, description?: string}>} choices - List of choices
   * @param {string} defaultValue - Default selection
   * @returns {Promise<string>} Selected value
   */
  static async select(message, choices, defaultValue = null) {
    const selectable = choices.filter(
      c => !(c instanceof inquirer.Separator) && c.type !== 'separator'
    );
    let defaultIndex = 0;
    if (defaultValue != null) {
      const idx = selectable.findIndex(c => c.value === defaultValue);
      if (idx >= 0) defaultIndex = idx;
    }
    const { value } = await this._rawSelect(message, choices, { defaultIndex });
    return value;
  }

  /**
   * Two-level tree selector: pick a category, then an item within it.
   * Selecting "← Back" or pressing Esc/Backspace returns to category selection.
   * @param {string} message - Prompt shown at category level
   * @param {Array<{label: string, value?: string, children: Array<{name: string, value: string}>}>} tree
   * @returns {Promise<string>} The selected leaf value
   */
  static async selectTree(message, tree) {
    const BACK = Symbol('back');

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const categoryChoices = tree.map(node => {
        const count = node.children.length;
        const suffix = chalk.dim(` (${count})`);
        return {
          name: `${node.label}${suffix}`,
          value: node.value ?? node.label,
          short: node.label,
        };
      });

      const { value: selectedCategory } = await this._rawSelect(message, categoryChoices);
      const node = tree.find(n => (n.value ?? n.label) === selectedCategory);

      if (node.children.length === 1) {
        return node.children[0].value;
      }

      const itemChoices = [
        ...node.children.map(child => ({
          name: child.name,
          value: child.value,
          short: child.value,
        })),
        new inquirer.Separator(),
        { name: chalk.dim('← Back'), value: BACK },
      ];

      const { value: selected, back } = await this._rawSelect(
        `Select from ${chalk.cyan(node.label)}:`,
        itemChoices,
        { allowBack: true }
      );

      if (!back && selected !== BACK) {
        return selected;
      }
    }
  }

  /**
   * Confirm an action with the user
   * @param {string} message - The confirmation message
   * @param {boolean} defaultValue - Default answer (true/false)
   * @returns {Promise<boolean>} User's confirmation
   */
  static async confirm(message, defaultValue = false) {
    const answer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message,
        default: defaultValue,
      },
    ]);

    return answer.confirmed;
  }

  /**
   * Prompt for text input
   * @param {string} message - The prompt message
   * @param {string} defaultValue - Default value
   * @param {Function} validate - Validation function
   * @returns {Promise<string>} User's input
   */
  static async input(message, defaultValue = '', validate = null) {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'value',
        message,
        default: defaultValue,
        validate: validate || (() => true),
      },
    ]);

    return answer.value;
  }

  /**
   * Prompt user to select multiple items from a list
   * @param {string} message - The prompt message
   * @param {Array<{name: string, value: string, checked?: boolean}>} choices - List of choices
   * @returns {Promise<Array<string>>} Selected values
   */
  static async multiSelect(message, choices) {
    const answer = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selections',
        message,
        choices,
        pageSize: 10,
      },
    ]);

    return answer.selections;
  }

  /**
   * Prompt for password input (hidden)
   * @param {string} message - The prompt message
   * @returns {Promise<string>} User's password
   */
  static async password(message) {
    const answer = await inquirer.prompt([
      {
        type: 'password',
        name: 'value',
        message,
      },
    ]);

    return answer.value;
  }
}
