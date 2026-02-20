import inquirer from 'inquirer';
import chalk from 'chalk';

/**
 * Base prompt utilities for interactive CLI
 * Provides generic prompt methods that can be used throughout the application
 */
export class Prompts {
  /**
   * Prompt user to select from a list of options
   * @param {string} message - The prompt message
   * @param {Array<{name: string, value: string, description?: string}>} choices - List of choices
   * @param {string} defaultValue - Default selection
   * @returns {Promise<string>} Selected value
   */
  static async select(message, choices, defaultValue = null) {
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'selection',
        message,
        choices,
        default: defaultValue,
        pageSize: 10,
      },
    ]);
    
    return answer.selection;
  }

  /**
   * Two-level tree selector: pick a category, then an item within it.
   * Selecting "← Back" returns to category selection.
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

      const selectedCategory = await this.select(message, categoryChoices);
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

      const selected = await this.select(
        `Select from ${chalk.cyan(node.label)}:`,
        itemChoices,
      );

      if (selected !== BACK) {
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

