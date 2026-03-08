#!/usr/bin/env node

import { Command } from 'commander';
import { join } from 'path';
import chalk from 'chalk';
import figlet from 'figlet';
import { Lok8sManager } from './lib/lok8s.js';
import { AgentGatewayManager } from './lib/agentgateway.js';
import { checkDependencies, Logger } from './lib/common.js';
import { ProfileManager } from './lib/profiles.js';
import { UseCaseManager } from './lib/usecase.js';
import { AddonInstaller } from './lib/addons.js';
import { CLI_VERSION, CLI_DESCRIPTION } from './lib/version.js';

const program = new Command();

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000);
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

// Show banner
function showBanner() {
  const banner = figlet.textSync('Agentgateway', { font: 'Standard', horizontalLayout: 'default' });
  console.log(chalk.blue(banner));
  console.log(chalk.gray(`  Solo.io Agentgateway v${CLI_VERSION}\n`));
}

program
  .name('agw')
  .description(CLI_DESCRIPTION)
  .version(CLI_VERSION)
  .hook('preAction', () => {
    showBanner();
  });

program
  .command('version')
  .description('Display banner, version, and description')
  .option('-s, --short', 'Print only version and description (one per line) for scripts')
  .action((options) => {
    if (options.short) {
      console.log(CLI_VERSION);
      console.log(CLI_DESCRIPTION);
      return;
    }
    console.log(chalk.gray('  Description: ') + chalk.white(CLI_DESCRIPTION));
    console.log(chalk.gray('  Version:     ') + chalk.white(CLI_VERSION));
    console.log(chalk.gray('  Node:        ') + chalk.white(process.version));
    console.log();
  });

// Base commands
const base = program.command('base').description('Manage base infrastructure');

base
  .command('install-infra')
  .description('Install infrastructure only (lok8s cluster)')
  .action(async () => {
    try {
      Logger.info('Installing infrastructure...');
      await Lok8sManager.start();
      Logger.success('Infrastructure installed successfully');
    } catch (error) {
      Logger.error('Failed to install infrastructure');
      process.exit(1);
    }
  });

base
  .command('clean-infra')
  .description('Remove lok8s cluster (infrastructure)')
  .action(async () => {
    try {
      Logger.info('Cleaning infrastructure...');
      await Lok8sManager.delete();
      Logger.success('Infrastructure removed successfully');
    } catch (error) {
      Logger.error('Failed to clean infrastructure');
      process.exit(1);
    }
  });

base
  .command('clean-addons')
  .description('Clean up all profile-based addons (telemetry, solo-ui, cert-manager)')
  .action(async () => {
    try {
      Logger.info('Cleaning up all addons...');
      await AddonInstaller.cleanupAllAddons();
    } catch (error) {
      Logger.error('Failed to clean addons');
      if (error.message) Logger.error(error.message);
      process.exit(1);
    }
  });

base
  .command('install-gateway')
  .description('Install agentgateway enterprise with optional addons')
  .option('-p, --profile <name>', 'Installation profile (standard, standard-with-telemetry, advanced)')
  .option('--no-prompt', 'Skip interactive prompts and use defaults')
  .action(async (options) => {
    const startTime = Date.now();
    try {
      Logger.info('Installing agentgateway...');

      // Determine which profile to use
      let profileFile = null;
      let profileData = null;
      
      if (options.profile) {
        profileFile = join(ProfileManager.PROFILES_DIR, `${options.profile}.yaml`);
        Logger.info(`Using profile: ${options.profile}`);
        try {
          profileData = await ProfileManager.load(profileFile);
        } catch (error) {
          Logger.error(`Failed to load profile ${options.profile}: ${error.message}`);
          throw error;
        }
      } else if (options.prompt !== false) {
        try {
          const profile = await ProfileManager.select();
          Logger.info(`Selected profile: ${profile.name}`);
          profileFile = profile.file;
          profileData = await ProfileManager.load(profileFile);
        } catch (error) {
          Logger.error(`Failed to select/load profile: ${error.message}`);
          throw error;
        }
      }

      if (profileData && profileData.addons.length > 0) {
        Logger.info(`Installing ${profileData.addons.length} prerequisite addon(s) from profile...`);
        await AddonInstaller.installAddons(profileData.addons);
      }
      
      await AgentGatewayManager.install(profileFile);
      await AgentGatewayManager.installProxy();
      
      Logger.success(`Gateway and all addons installed successfully in (${formatDuration(Date.now() - startTime)})`);
    } catch (error) {
      Logger.error('Failed to install gateway');
      if (error.message) {
        Logger.error(`Error: ${error.message}`);
      }
      if (error.stack && process.env.DEBUG) {
        Logger.debug(error.stack);
      }
      process.exit(1);
    }
  });

base
  .command('install')
  .description('Install everything (infrastructure + gateway + addons)')
  .option('-p, --profile <name>', 'Installation profile (standard, standard-with-telemetry, advanced)')
  .option('--no-prompt', 'Skip interactive prompts and use defaults')
  .action(async (options) => {
    try {
      Logger.info('Installing complete stack...');
      
      // Install infrastructure first
      await Lok8sManager.start();
           
      // Determine which profile to use
      let profileFile = null;
      let profileData = null;
      
      if (options.profile) {
        profileFile = join(ProfileManager.PROFILES_DIR, `${options.profile}.yaml`);
        Logger.info(`Using profile: ${options.profile}`);
        try {
          profileData = await ProfileManager.load(profileFile);
        } catch (error) {
          Logger.error(`Failed to load profile ${options.profile}: ${error.message}`);
          throw error;
        }
      } else if (options.prompt !== false) {
        try {
          const profile = await ProfileManager.select();
          Logger.info(`Selected profile: ${profile.name}`);
          profileFile = profile.file;
          profileData = await ProfileManager.load(profileFile);
        } catch (error) {
          Logger.error(`Failed to select/load profile: ${error.message}`);
          throw error;
        }
      }

      if (profileData && profileData.addons.length > 0) {
        Logger.info(`Installing ${profileData.addons.length} prerequisite addon(s) from profile...`);
        await AddonInstaller.installAddons(profileData.addons);
      }
      
      await AgentGatewayManager.install(profileFile);
      await AgentGatewayManager.installProxy();
      
      Logger.success('Complete stack installed successfully');
    } catch (error) {
      Logger.error('Failed to install complete stack');
      process.exit(1);
    }
  });

base
  .command('start')
  .description('Start lok8s cluster')
  .action(async () => {
    try {
      await Lok8sManager.start();
    } catch (error) {
      Logger.error('Failed to start lok8s');
      process.exit(1);
    }
  });

base
  .command('stop')
  .description('Stop lok8s cluster')
  .action(async () => {
    try {
      await Lok8sManager.stop();
    } catch (error) {
      Logger.error('Failed to stop lok8s');
      process.exit(1);
    }
  });

base
  .command('status')
  .description('Show infrastructure status')
  .action(async () => {
    try {
      await Lok8sManager.status();
      console.log('');
      await AgentGatewayManager.status();
    } catch (error) {
      Logger.error('Failed to get status');
      process.exit(1);
    }
  });

base
  .command('cleanup')
  .description('Clean up all infrastructure')
  .action(async () => {
    try {
      const inquirer = (await import('inquirer')).default;
      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: chalk.yellow('This will delete the entire cluster and all resources. Are you sure?'),
          default: false,
        },
      ]);

      if (answers.confirm) {
        await AgentGatewayManager.uninstall();
        await Lok8sManager.delete();
        Logger.success('Cleanup completed');
      } else {
        Logger.info('Cleanup cancelled');
      }
    } catch (error) {
      Logger.error('Failed to cleanup');
      process.exit(1);
    }
  });

// Provider commands
const provider = program.command('provider').description('Manage LLM providers');

provider
  .command('list')
  .description('List configured providers')
  .action(() => {
    Logger.info('Provider management coming soon...');
  });

// Feature commands
const feature = program.command('feature').description('Manage features');

feature
  .command('list')
  .description('List available features')
  .action(() => {
    Logger.info('Feature management coming soon...');
  });

// Profile commands
const profile = program.command('profile').description('Manage installation profiles');

profile
  .command('list')
  .description('List available installation profiles')
  .action(async () => {
    try {
      const profiles = await ProfileManager.list();
      
      console.log('\nAvailable profiles:');
      profiles.forEach(p => {
        console.log(`  ${chalk.cyan(p.name.padEnd(12))} - ${p.description}`);
      });
      console.log('');
    } catch (error) {
      Logger.error('Failed to list profiles');
      process.exit(1);
    }
  });

// Use case commands
const usecase = program.command('usecase').description('Manage use cases');

usecase
  .command('list')
  .description('List available use cases')
  .action(async () => {
    try {
      const usecases = await UseCaseManager.list();
      
      // Group by category
      const byCategory = {};
      usecases.forEach(u => {
        const category = u.category || 'root';
        if (!byCategory[category]) {
          byCategory[category] = [];
        }
        byCategory[category].push(u);
      });
      
      console.log('\nAvailable use cases:');
      Object.keys(byCategory).sort().forEach(category => {
        const categoryName = category === 'root' ? 'General' : category.toUpperCase();
        console.log(`\n  ${chalk.bold(categoryName)}:`);
        byCategory[category]
          .sort((a, b) => a.name.localeCompare(b.name))
          .forEach(u => {
            const name = u.category ? `${u.category}/${u.name}` : u.name;
            console.log(`    ${chalk.cyan('•')} ${name}`);
          });
      });
      console.log('');
    } catch (error) {
      Logger.error('Failed to list use cases');
      process.exit(1);
    }
  });

usecase
  .command('deploy')
  .description('Deploy a use case')
  .option('-n, --name <name>', 'Use case name')
  .option('-t, --test', 'Run use case tests after deploy')
  .option('--no-prompt', 'Skip interactive prompts')
  .option('--no-stepped', 'Deploy all at once without step-through (no diagrams, no wait for key)')
  .option('--no-diagrams', 'Hide ASCII flow diagrams during stepped deploy')
  .action(async (options) => {
    try {
      let usecaseName = null;

      if (options.name) {
        // Use case specified via command line
        usecaseName = options.name;
      } else if (options.prompt !== false) {
        // Interactive mode - prompt user to select use case
        const usecase = await UseCaseManager.select();
        usecaseName = usecase.name;
      } else {
        Logger.error('Please specify a use case with --name or run without --no-prompt');
        process.exit(1);
      }

      await UseCaseManager.deploy(usecaseName, {
        stepped: options.stepped !== false,
        prompt: options.prompt !== false,
        diagrams: options.diagrams !== false,
      });

      if (options.test) {
        await UseCaseManager.test(usecaseName);
      }
    } catch (error) {
      // UseCaseManager already logged the error with spinner.fail()
      process.exit(1);
    }
  });

usecase
  .command('dryrun')
  .description('Show generated YAML for a use case without applying (copy-friendly output)')
  .option('-n, --name <name>', 'Use case name')
  .option('--no-prompt', 'Skip interactive prompts')
  .action(async (options) => {
    try {
      let usecaseName = null;

      if (options.name) {
        usecaseName = options.name;
      } else if (options.prompt !== false) {
        const usecase = await UseCaseManager.select();
        usecaseName = usecase.name;
      } else {
        Logger.error('Please specify a use case with --name or run without --no-prompt');
        process.exit(1);
      }

      await UseCaseManager.dryRun(usecaseName);
    } catch (error) {
      Logger.error(error.message);
      process.exit(1);
    }
  });

usecase
  .command('test')
  .description('Test a deployed use case')
  .option('-n, --name <name>', 'Use case name')
  .option('--no-prompt', 'Skip interactive prompts')
  .action(async (options) => {
    try {
      let usecaseName = null;
      
      if (options.name) {
        // Use case specified via command line
        usecaseName = options.name;
      } else if (options.prompt !== false) {
        // Interactive mode - prompt user to select use case
        const usecase = await UseCaseManager.select();
        usecaseName = usecase.name;
      } else {
        Logger.error('Please specify a use case with --name or run without --no-prompt');
        process.exit(1);
      }
      
      await UseCaseManager.test(usecaseName);
    } catch (error) {
      // UseCaseManager already logged the error
      process.exit(1);
    }
  });

usecase
  .command('cleanup')
  .description('Clean up a deployed use case')
  .option('-n, --name <name>', 'Use case name')
  .option('-a, --all', 'Clean up the currently deployed use case (if any)')
  .option('--no-prompt', 'Skip interactive prompts')
  .action(async (options) => {
    try {
      if (options.all) {
        await UseCaseManager.cleanupAll();
        return;
      }

      let usecaseName = null;

      if (options.name) {
        // Use case specified via command line
        usecaseName = options.name;
      } else if (options.prompt !== false) {
        // Interactive mode - prompt user to select use case
        const usecase = await UseCaseManager.select();
        usecaseName = usecase.name;
      } else {
        Logger.error('Please specify a use case with --name or --all, or run without --no-prompt');
        process.exit(1);
      }

      await UseCaseManager.cleanup(usecaseName);
    } catch (error) {
      // UseCaseManager already logged the error with spinner.fail()
      process.exit(1);
    }
  });

usecase
  .command('generate-diagrams')
  .description('Generate spec.diagram (Mermaid) for all use case YAML files')
  .action(async () => {
    try {
      const { updated, skipped, errors } = await UseCaseManager.generateDiagramsForAll();
      if (errors.length > 0) {
        errors.forEach(({ file, error }) => Logger.error(`${file}: ${error}`));
        process.exit(1);
      }
      console.log(chalk.green(`Updated ${updated.length} use case(s) with spec.diagram`));
      updated.forEach((f) => console.log(chalk.gray('  ') + f));
      if (skipped.length > 0) {
        console.log(chalk.gray(`Skipped ${skipped.length} (no steps or no features)`));
      }
    } catch (error) {
      Logger.error(error.message);
      process.exit(1);
    }
  });

// Utility commands
program
  .command('check-deps')
  .description('Check if required dependencies are installed')
  .action(async () => {
    const allInstalled = await checkDependencies();
    if (!allInstalled) {
      process.exit(1);
    }
  });

// Parse arguments
program.parse(process.argv);

// Show help if no arguments
if (process.argv.length === 2) {
  program.help();
}

