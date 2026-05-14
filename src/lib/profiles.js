import { readdir, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import { Prompts } from './prompts.js';
import { EnvironmentManager } from './environment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');

/**
 * Profile management utilities
 * Handles agentgateway installation profiles with extensible service support
 */
export class ProfileManager {
  static PROFILES_DIR = join(PROJECT_ROOT, 'config/profiles');

  static DESCRIPTIONS = {
    'agentgateway-standard': 'Standard installation',
    'agentgateway-with-observability':
      'Full observability stack (Solo UI, Prometheus, Grafana, Loki, Tempo)',
    'agentgateway-with-solo-ui': 'Observability with Solo UI stack',
    'agentgateway-custom-config': 'Custom configuration',
    'agentgateway-custom-version':
      'Custom version, OCI registry, and controller extraEnv (e.g. Gateway API experimental)',
    'agentgateway-with-keycloak': 'Includes Keycloak integration with the full observability stack',
    'eks-agentgateway-with-keycloak':
      'Keycloak and observability for EKS (gp3 storage, worker node selectors, LoadBalancer services)',
  };

  /**
   * Get all available profiles
   * @returns {Promise<Array<{name: string, file: string, description: string}>>}
   */
  static async list(root) {
    const dir = root ? join(root, 'config', 'profiles') : this.PROFILES_DIR;
    try {
      const files = await readdir(dir);
      const yamlFiles = files.filter(f => f.endsWith('.yaml'));
      return yamlFiles.map(file => {
        const name = basename(file, '.yaml');
        return {
          name,
          file: join(dir, file),
          description: this.DESCRIPTIONS[name] || 'Custom profile',
        };
      });
    } catch (error) {
      throw new Error(`Failed to list profiles: ${error.message}`);
    }
  }

  /**
   * Load and parse a profile file with environment template resolution
   * @param {string} profilePath - Path to profile YAML file
   * @returns {Promise<{helmValues: object, addons: Array, resources: Array}>}
   */
  static async load(profilePath) {
    try {
      const content = await readFile(profilePath, 'utf8');
      let profile = yaml.load(content);

      // Resolve environment templates if profile specifies an environment
      if (profile.environment) {
        try {
          const environment = await EnvironmentManager.load(profile.environment);
          profile = EnvironmentManager.resolveAllTemplates(profile, environment);
        } catch (envError) {
          // If environment loading fails, continue without resolution
          // This allows profiles without environments to work
          if (!envError.message.includes('not found')) {
            throw envError;
          }
        }
      }

      return {
        helmValues: profile.helmValues || profile,
        addons: profile.addons || [],
        resources: profile.resources || [],
      };
    } catch (error) {
      throw new Error(`Failed to load profile: ${error.message}`);
    }
  }

  /**
   * Prompt user to select a profile
   * @param {string} defaultProfile - Default profile name
   * @returns {Promise<{name: string, file: string}>} Selected profile
   */
  static async select(defaultProfile = 'standard') {
    try {
      const profiles = await this.list();

      if (profiles.length === 0) {
        throw new Error('No profiles found in config/profiles/');
      }

      const choices = profiles
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(profile => ({
          name: `${profile.name.padEnd(12)} - ${profile.description}`,
          value: profile.name,
          short: profile.name,
        }));

      const selectedName = await Prompts.select(
        'Select agentgateway installation profile:',
        choices,
        defaultProfile
      );

      const profile = profiles.find(p => p.name === selectedName);

      return {
        name: profile.name,
        file: profile.file,
      };
    } catch (error) {
      throw new Error(`Failed to select profile: ${error.message}`);
    }
  }
}
