import { readdir, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import { Prompts } from './prompts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');

/**
 * Profile management utilities
 * Handles kgateway installation profiles with extensible service support
 */
export class ProfileManager {
  static PROFILES_DIR = join(PROJECT_ROOT, 'config/profiles');
  
  static DESCRIPTIONS = {
    'standard-agentgateway': 'Standard AgentGateway installation',
    'agentgateway-with-observability': 'AgentGateway with full observability stack (Solo UI,Prometheus, Grafana, Loki, Tempo)',
    'agentgateway-with-solo-ui': 'AgentGateway with Solo UI stack',
    'agentgateway-custom-config': 'AgentGateway with custom configuration',
    'agentgateway-custom-version': 'AgentGateway with custom version, OCI registry, and controller extraEnv (e.g. Gateway API experimental)',
    'agentgateway-with-obo': 'AgentGateway with OBO token exchange (Keycloak + STS)',
  };

  /**
   * Get all available profiles
   * @returns {Promise<Array<{name: string, file: string, description: string}>>}
   */
  static async list() {
    try {
      const files = await readdir(this.PROFILES_DIR);
      const yamlFiles = files.filter(f => f.endsWith('.yaml'));
      
      return yamlFiles.map(file => {
        const name = basename(file, '.yaml');
        return {
          name,
          file: join(this.PROFILES_DIR, file),
          description: this.DESCRIPTIONS[name] || 'Custom profile',
        };
      });
    } catch (error) {
      throw new Error(`Failed to list profiles: ${error.message}`);
    }
  }

  /**
   * Get a specific profile by name
   * @param {string} name - Profile name
   * @returns {Promise<{name: string, file: string, description: string}>}
   */
  static async get(name) {
    const profiles = await this.list();
    const profile = profiles.find(p => p.name === name);
    
    if (!profile) {
      throw new Error(`Profile '${name}' not found`);
    }
    
    return profile;
  }

  /**
   * Check if a profile exists
   * @param {string} name - Profile name
   * @returns {Promise<boolean>}
   */
  static async exists(name) {
    try {
      await this.get(name);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load and parse a profile file
   * @param {string} profilePath - Path to profile YAML file
   * @returns {Promise<{helmValues: object, addons: Array, resources: Array}>}
   */
  static async load(profilePath) {
    try {
      const content = await readFile(profilePath, 'utf8');
      const profile = yaml.load(content);
      
      return {
        helmValues: profile.helmValues || profile,
        addons: profile.addons || [],
        resources: profile.resources || []
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

      const choices = profiles.map(profile => ({
        name: `${profile.name.padEnd(12)} - ${profile.description}`,
        value: profile.name,
        short: profile.name,
      }));

      const selectedName = await Prompts.select(
        'Select kgateway installation profile:',
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

  /**
   * Add a new profile description
   * @param {string} name - Profile name
   * @param {string} description - Profile description
   */
  static addDescription(name, description) {
    this.DESCRIPTIONS[name] = description;
  }
}

