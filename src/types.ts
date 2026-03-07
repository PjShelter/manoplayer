import type { CharacterModel } from 'webgal_mano';

export interface LoadedCharacterModel {
  modelPath: string;
  baseDir: string;
  serverUrl: string;
  revision: number;
  model: CharacterModel;
}
