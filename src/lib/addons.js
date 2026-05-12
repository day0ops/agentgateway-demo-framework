import { FeatureManager } from './feature.js';
import { Logger, SpinnerLogger, formatDuration } from './common.js';

import '../../addons/index.js';

const PROFILE_ADDONS = [
  { name: 'telemetry', namespace: 'telemetry' },
  { name: 'solo-ui', namespace: 'agentgateway-system' },
  { name: 'cert-manager', namespace: 'cert-manager' },
  { name: 'keycloak', namespace: 'keycloak' },
  { name: 'external-dns', namespace: 'external-dns' },
];

export class AddonInstaller {
  static async installAddons(addons = []) {
    if (!addons || addons.length === 0) {
      Logger.info('No additional addons to install');
      return;
    }

    Logger.info(`Installing ${addons.length} additional addon(s)...`);
    const startTime = Date.now();

    for (const addon of addons) {
      await this.installAddon(addon);
    }

    Logger.success(`All addons installed successfully (${formatDuration(Date.now() - startTime)})`);
  }

  static async installAddon(addon) {
    const { name, description, namespace, config = {} } = addon;
    const spinner = new SpinnerLogger();
    const startTime = Date.now();

    try {
      spinner.start(`Installing addon: ${name}...`);

      const featureExists = FeatureManager.has(name);

      if (!featureExists) {
        spinner.warn(`Addon '${name}' does not have a feature implementation, skipping`);
        return;
      }

      const mergedConfig = { ...config, ...(namespace && { namespace }) };
      await FeatureManager.deploy(name, mergedConfig, { spinner });

      const elapsed = formatDuration(Date.now() - startTime);
      spinner.succeed(
        `Addon '${name}' installed${description ? `: ${description}` : ''} (${elapsed})`
      );
    } catch (error) {
      const elapsed = formatDuration(Date.now() - startTime);
      spinner.fail(`Failed to install addon '${name}' after ${elapsed}: ${error.message}`);
      throw error;
    }
  }

  static async cleanupAddons(addons = []) {
    if (!addons || addons.length === 0) {
      return;
    }

    Logger.info(`Cleaning up ${addons.length} addon(s)...`);

    for (const addon of addons) {
      await this.cleanupAddon(addon);
    }
  }

  static async cleanupAddon(addon) {
    const { name, namespace } = addon;
    const spinner = new SpinnerLogger();

    try {
      const featureExists = FeatureManager.has(name);

      if (!featureExists) {
        Logger.warn(`Addon '${name}' does not have a feature implementation, skipping cleanup`);
        return;
      }

      spinner.start(`Cleaning up addon: ${name}...`);
      await FeatureManager.cleanup(name, namespace ? { namespace, spinner } : { spinner });
      spinner.succeed(`Addon '${name}' cleaned up`);
    } catch (error) {
      spinner.fail(`Failed to cleanup addon '${name}': ${error.message}`);
    }
  }

  static async cleanupAllAddons() {
    await this.cleanupAddons(PROFILE_ADDONS);
    Logger.success('All addons cleaned up');
  }
}
