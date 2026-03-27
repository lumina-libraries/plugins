import type StoreAdapter from "@lumina-engine/store";
import type { ArrayCommand, Command } from "@lumina-engine/commands";
import type { IPluginAPI } from "@lumina-engine/types";
import { CustomObject3D } from "@lumina-engine/objects";
import { CustomStoreObject } from "@lumina-engine/store-objects";

import {
     type MeshStandardMaterialParameters,
     Vector3,
     Quaternion,
     Matrix4,
     Box3,
     Scene,
     InstancedMesh,
     MeshStandardMaterial,
     TextureLoader,
     NearestFilter,
     RepeatWrapping,
     DynamicDrawUsage,
     BufferGeometry,
     BufferAttribute,
     LineBasicMaterial,
     LineSegments,
     Color,
     Texture,
     BoxGeometry,
     Float32BufferAttribute,
     Object3D,
     Mesh,
     PlaneGeometry,
     DoubleSide,
     Group,
     CapsuleGeometry,
     Euler,
} from "three";

declare const api: IPluginAPI;

type OBBArray = [
     cx: number, cy: number, cz: number,
     hx: number, hy: number, hz: number,
     qx: number, qy: number, qz: number, qw: number
];

interface MapObject {
     id: string;
     i: number;
     p: number[];
     s: number[];
     r?: [x: number, y: number, z: number];
     t?: string;
     col?: number; // Collision: 1 = no, 0 = yes
     color?: number; // Object color (hex)
     da?: number;
     d?: number;
     v?: number;
     ladderHeight?: number;
     ter?: number;
     obb: OBBArray;
}


interface CubeshotCSMData {
     cascades: number;
     maxFar: number;
     mode: string;
     shadowMapSize: number;
     shadowBias: number;
     shadowNormalBias: number;
     fade: boolean;
     lightDirection: [number, number, number];
     lightIntensity: number;
     lightColor: number;
     lightNear: number;
     lightFar: number;
     lightMargin: number;
}

interface CubeshotMapData {
     name?: string;
     objects: MapObject[];
     spawns?: number[][];
     camPos?: number[];
     modes?: number[];
     sky?: number;
     fog?: number;
     fogD?: number;
     light?: number;
     ambient?: number;
     terrain?: number;
     shadScale?: number;
     csm?: CubeshotCSMData;
}
const IMPORT_FROM_URL_OPTION = {
     type: "text" as const,
     value: "",
     label: 'Import from URL',
     placeholder: 'https://cubeshot.io/map.json'
}

const WELCOME_MESSAGE = `
<div align="center">
  <img src="https://cubeshot.io/img/cubeshot.png" alt="Cubeshot Logo" width="200" />
  <h3>Official Map Editor Plugin</h3>
</div>

Welcome to the advanced map editor for **Cubeshot.io**! Create competitive arenas with ease using optimized tools and custom objects.

#### Camera Controls
- **W, A, S, D** : Move Camera
- **Space / E** : Fly Up
- **Q** : Fly Down
- **Shift** : Sprint (2x Speed)
- **Right Click** : Look Around

#### Editor Utilities
- **Object Types**: Full suite of game objects (Ladders, Spawns, Death Zones, etc.)
- **Optimized Rendering**: Instanced rendering for thousands of blocks.
- **Environment**: Tune sky, fog, and lighting via Environment settings.
- **Snapping**: Precision placement tools.
- **Import/Export**: Seamless JSON map support.

*Get started by importing a map URL below, or close this dialog to start fresh!*

**Try this demo map:**

\`https://fuchsia-personal-angelfish-648.mypinata.cloud/ipfs/bafkreib4vhghrdsya6ytdc6zbcm7wx6y5z44iw5u7zsd3qhdpat5xhamiu\`

> *Snap settings don't actualy work yet...*
`

const ASSETS_MESSAGE = `
<div align="center">
  <img src="https://cubeshot.io/img/cubeshot.png" alt="Cubeshot Logo" width="200" />
  <h3>Custom Assets</h3>
</div>

You will be prompted to select a folder to store your custom assets.

### Storage Structure (Relative to the selected folder):

- \`textures/\` - Folder to store custom textures
- \`models/\` - Folder to store custom models
- \`manifest.json\` - Manifest file to store the list of custom textures and models
`

const MAP_SETTINGS_COMPONENT_NAME = 'cubeshot-map-settings';

enum SnapOptions {
     POSITION = 'position',
     ROTATION = 'rotation',
     SCALE = 'scale'
}

enum ScaleOptions {
     MAP_SCALE = 'mapScale'
}

const SCALE_GROUP_NAME = 'Map Scale';

const DEFAULT_TEXTURE_IDS = [
     'WALL', 'DIRT', 'FLOOR', 'GRID',
     'GREY', 'DEFAULT', 'ROOF', 'FLAG', 'GRASS', 'CHECK',
     'LINES', 'BRICK', 'LINK', 'SANDWALL'
];

const DEFAULT_PREFAB_IDS = [
     'CUBE', 'CRATE', 'BARREL', 'LADDER', 'PLANE',
     'SPAWN_POINT', 'CAMERA_POSITION', 'VEHICLE', 'STACK', 'RAMP', 'SCORE_ZONE',
     'BILLBOARD', 'DEATH_ZONE', 'PARTICLES', 'OBJECTIVE', 'TREE', 'CONE',
     'CONTAINER', 'GRASS', 'CONTAINERR', 'ACIDBARREL', 'DOOR', 'WINDOW',
     'FLAG', 'WATER', 'CHECK_POINT', 'WEAPON_PICKUP', 'TELEPORTER'
];

const DEFAULT_MODELS = [
     'CRATE', 'BARREL',
     'VEHICLE', 'STACK',
     'TREE', 'CONE',
     'CONTAINER', 'GRASS', 'CONTAINERR', 'ACIDBARREL', 'DOOR', 'WINDOW',
];

// Custom assets storage - will be populated from File System Directory API
interface CustomAsset {
     id: string;
     name: string;
     blobUrl: string;
     textureBlobUrl?: string; // For models that have their own texture
}

const customTextures: CustomAsset[] = [];
const customModels: CustomAsset[] = [];

// Dynamic arrays that combine default + custom assets
const TEXTURE_IDS: string[] = [...DEFAULT_TEXTURE_IDS];
const PREFAB_IDS: string[] = [...DEFAULT_PREFAB_IDS];
const MODELS: string[] = [...DEFAULT_MODELS];

// Blob URL storage for custom assets
const customModelBlobs: Record<string, Promise<Blob | null>> = {};
const customTextureUrls: Record<string, string> = {};

const ORIGIN = 'https://cubeshot.io';
const LOG_PREFIX = '[Cubeshot]';

// =====================================================
// Shared Helper Functions
// =====================================================

/** Get texture URL - checks custom textures first, falls back to origin */
function getTextureUrl(textureId: string): string {
     const customUrl = customTextureUrls[textureId];
     if (customUrl) return customUrl;

     const textureName = textureId.toLowerCase() === 'default' ? 'wall' : textureId.toLowerCase();
     return `${ORIGIN}/textures/${textureName}_0.png`;
}

/** Shared TextureLoader instance with cross-origin configured */
const sharedTextureLoader = new TextureLoader();
sharedTextureLoader.setCrossOrigin('anonymous');

/** Load a texture with standard settings (nearest filter, repeat wrapping) */
function loadTexture(url: string, onLoad?: (texture: Texture) => void): Texture {
     return sharedTextureLoader.load(url, (tex) => {
          tex.minFilter = NearestFilter;
          tex.magFilter = NearestFilter;
          tex.wrapS = RepeatWrapping;
          tex.wrapT = RepeatWrapping;
          tex.needsUpdate = true;
          onLoad?.(tex);
     });
}

/** Check if store is ready and not in headless mode */
function isStoreReady(obj: { store?: StoreAdapter; headless?: boolean }): obj is { store: StoreAdapter; headless: false } {
     return !!obj.store && !obj.headless;
}

/** Initialize helper manager scene if available */
function initHelperScene(store?: StoreAdapter): void {
     if (store?.scene) helperManager.setScene(store.scene);
}

/** Default thumbnail generation options */
const DEFAULT_THUMBNAIL_OPTIONS = {
     width: 128,
     height: 128,
     rotation: true,
     rotationValues: [Math.PI * 0.2, Math.PI * 0.25, 0] as [number, number, number],
     autoFit: true,
     fitPadding: 1,
     format: 'png' as const,
     exposure: 1.0
};

/** Create a store folder with common settings */
function createStoreFolder(name: string, id: string, priority: number, open: boolean = true): void {
     if (api.hasFolder(id)) return;
     const folder = api.createFolder(name, id);
     folder.deletable = false;
     folder.priority = priority;
     folder.open = open;
}

const MODEL_BLOBS: Record<string, Promise<Blob | null>> = (() => {

     const repo: Record<string, Promise<Blob | null>> = {};

     for (const model of DEFAULT_MODELS) {

          const url = `${ORIGIN}/models/${model.toLowerCase()}_0.obj`;

          repo[model] = fetch(url).then(res => res.blob()).catch(() => null);
     }

     return repo;
})();

// =====================================================
// Custom Asset Storage Manager using File System API
// =====================================================

const CUSTOM_ASSETS_DIR_ID = 'cubeshot-custom-assets';
const CUSTOM_TEXTURES_SUBDIR = 'textures';
const CUSTOM_MODELS_SUBDIR = 'models';
const MANIFEST_FILE = 'manifest.json';

interface CustomAssetManifest {
     textures: Array<{ id: string; name: string; fileName: string }>;
     models: Array<{ id: string; name: string; modelFileName: string; textureFileName?: string }>;
}

class CustomAssetStorage {
     private directory: any = null;
     private texturesDir: any = null;
     private modelsDir: any = null;
     private initialized = false;
     private manifest: CustomAssetManifest = { textures: [], models: [] };

     async initialize(): Promise<boolean> {

          try {

               await api.showDialog(
                    'Select Custom Assets Folder',
                    'Choose a folder to store your custom textures and models',
                    [{
                         type: "markdown",
                         value: ASSETS_MESSAGE,
                         label: 'Custom Assets'
                    }],
                    { maxWidth: "90%", confirmText: 'Continue' }
               ).promise;

               // Request directory access using the plugin API
               this.directory = await api.openDirectory(CUSTOM_ASSETS_DIR_ID, {
                    title: 'Select Custom Assets Folder',
                    message: 'Choose a folder to store your custom textures and models'
               });

               if (!this.directory) {
                    console.warn('[Cubeshot] No custom assets directory selected');
                    return false;
               }

               // Get or create subdirectories
               this.texturesDir = await api.getDirectory(this.directory, CUSTOM_TEXTURES_SUBDIR, true);
               this.modelsDir = await api.getDirectory(this.directory, CUSTOM_MODELS_SUBDIR, true);

               // Load manifest
               await this.loadManifest();

               this.initialized = true;
               return true;
          } catch (error) {
               console.error('[Cubeshot] Failed to initialize custom asset storage:', error);
               return false;
          }
     }

     async isInitialized(): Promise<boolean> {
          return this.initialized;
     }

     private async loadManifest(): Promise<void> {
          try {
               const manifestFile = await api.getFile(this.directory, MANIFEST_FILE, false);
               if (manifestFile) {
                    const text = await manifestFile.text();
                    if (text) this.manifest = JSON.parse(text);
               }
          } catch (error) {
               console.warn('[Cubeshot] No manifest found, starting fresh');
               this.manifest = { textures: [], models: [] };
          }
     }

     private async saveManifest(): Promise<void> {
          try {
               const manifestFile = await api.getFile(this.directory, MANIFEST_FILE, true);
               if (manifestFile) await manifestFile.writeJson(this.manifest);
          } catch (error) {
               console.error('[Cubeshot] Failed to save manifest:', error);
          }
     }

     async saveTexture(id: string, name: string, blob: Blob): Promise<string | null> {
          if (!this.initialized || !this.texturesDir) return null;

          try {
               const fileName = `${id}.png`;
               const file = await api.getFile(this.texturesDir, fileName, true);

               if (file) await file.write(blob, "raw");

               // Update manifest
               const existingIndex = this.manifest.textures.findIndex(t => t.id === id);
               if (existingIndex >= 0) {
                    this.manifest.textures[existingIndex] = { id, name, fileName };
               } else {
                    this.manifest.textures.push({ id, name, fileName });
               }
               await this.saveManifest();

               // Return blob URL for immediate use
               return URL.createObjectURL(blob);
          } catch (error) {
               console.error('[Cubeshot] Failed to save texture:', error);
               return null;
          }
     }

     async saveModel(id: string, name: string, modelBlob: Blob, textureBlob?: Blob): Promise<{ modelUrl: string; textureUrl?: string } | null> {
          if (!this.initialized || !this.modelsDir) return null;

          try {
               const modelFileName = `${id}.obj`;
               const modelFile = await api.getFile(this.modelsDir, modelFileName, true);

               if (modelFile) await modelFile.write(modelBlob, "raw");

               let textureFileName: string | undefined;
               let textureUrl: string | undefined;

               if (textureBlob) {
                    textureFileName = `${id}_texture.png`;
                    const textureFile = await api.getFile(this.modelsDir, textureFileName, true);

                    if (textureFile) await textureFile.write(textureBlob, "raw");

                    textureUrl = URL.createObjectURL(textureBlob);
               }

               // Update manifest
               const existingIndex = this.manifest.models.findIndex(m => m.id === id);
               if (existingIndex >= 0) {
                    this.manifest.models[existingIndex] = { id, name, modelFileName, textureFileName };
               } else {
                    this.manifest.models.push({ id, name, modelFileName, textureFileName });
               }
               await this.saveManifest();

               return {
                    modelUrl: URL.createObjectURL(modelBlob),
                    textureUrl
               };
          } catch (error) {
               console.error('[Cubeshot] Failed to save model:', error);
               return null;
          }
     }

     async loadAllAssets(): Promise<void> {
          if (!this.initialized) return;

          // Load textures
          for (const textureInfo of this.manifest.textures) {
               try {
                    const file = await api.getFile(this.texturesDir, textureInfo.fileName, false);
                    if (file) {
                         const blob = await file.read("raw");
                         const blobUrl = URL.createObjectURL(blob);

                         customTextures.push({
                              id: textureInfo.id,
                              name: textureInfo.name,
                              blobUrl
                         });

                         // Add to dynamic arrays
                         if (!TEXTURE_IDS.includes(textureInfo.id)) {
                              TEXTURE_IDS.push(textureInfo.id);
                         }
                         customTextureUrls[textureInfo.id] = blobUrl;
                    }
               } catch (error) {
                    console.warn(`[Cubeshot] Failed to load texture ${textureInfo.id}:`, error);
               }
          }

          // Load models
          for (const modelInfo of this.manifest.models) {
               try {
                    const modelFile = await api.getFile(this.modelsDir, modelInfo.modelFileName, false);
                    if (modelFile) {
                         const modelBlob = await modelFile.read("raw");
                         const modelBlobUrl = URL.createObjectURL(modelBlob);

                         let textureBlobUrl: string | undefined;
                         if (modelInfo.textureFileName) {
                              const textureFile = await api.getFile(this.modelsDir, modelInfo.textureFileName, false);
                              if (textureFile) {
                                   const textureBlob = await textureFile.read("raw");
                                   textureBlobUrl = URL.createObjectURL(textureBlob);
                              }
                         }

                         customModels.push({
                              id: modelInfo.id,
                              name: modelInfo.name,
                              blobUrl: modelBlobUrl,
                              textureBlobUrl
                         });

                         // Add to dynamic arrays
                         if (!MODELS.includes(modelInfo.id)) {
                              MODELS.push(modelInfo.id);
                         }
                         if (!PREFAB_IDS.includes(modelInfo.id)) {
                              PREFAB_IDS.push(modelInfo.id);
                         }

                         // Add to model blobs
                         MODEL_BLOBS[modelInfo.id] = Promise.resolve(modelBlob);

                         // Store texture URL if exists
                         if (textureBlobUrl) {
                              customTextureUrls[modelInfo.id] = textureBlobUrl;
                         }
                    }
               } catch (error) {
                    console.warn(`[Cubeshot] Failed to load model ${modelInfo.id}:`, error);
               }
          }
     }

     async removeTexture(id: string): Promise<boolean> {
          if (!this.initialized || !this.texturesDir) return false;

          try {
               const textureInfo = this.manifest.textures.find(t => t.id === id);
               if (!textureInfo) return false;

               await api.removeEntry(this.texturesDir, textureInfo.fileName);

               // Update manifest
               this.manifest.textures = this.manifest.textures.filter(t => t.id !== id);
               await this.saveManifest();

               // Remove from arrays
               const textureIndex = customTextures.findIndex(t => t.id === id);
               if (textureIndex >= 0) {
                    const texture = customTextures[textureIndex];
                    if (texture) {
                         URL.revokeObjectURL(texture.blobUrl);
                    }
                    customTextures.splice(textureIndex, 1);
               }

               const idIndex = TEXTURE_IDS.indexOf(id);
               if (idIndex >= 0 && !DEFAULT_TEXTURE_IDS.includes(id)) {
                    TEXTURE_IDS.splice(idIndex, 1);
               }

               delete customTextureUrls[id];

               return true;
          } catch (error) {
               console.error('[Cubeshot] Failed to remove texture:', error);
               return false;
          }
     }

     async removeModel(id: string): Promise<boolean> {
          if (!this.initialized || !this.modelsDir) return false;

          try {
               const modelInfo = this.manifest.models.find(m => m.id === id);
               if (!modelInfo) return false;

               await api.removeEntry(this.modelsDir, modelInfo.modelFileName);
               if (modelInfo.textureFileName) {
                    await api.removeEntry(this.modelsDir, modelInfo.textureFileName);
               }

               // Update manifest
               this.manifest.models = this.manifest.models.filter(m => m.id !== id);
               await this.saveManifest();

               // Remove from arrays
               const modelIndex = customModels.findIndex(m => m.id === id);
               if (modelIndex >= 0) {
                    const model = customModels[modelIndex];
                    if (model) {
                         URL.revokeObjectURL(model.blobUrl);
                         if (model.textureBlobUrl) {
                              URL.revokeObjectURL(model.textureBlobUrl);
                         }
                    }
                    customModels.splice(modelIndex, 1);
               }

               const modelsIndex = MODELS.indexOf(id);
               if (modelsIndex >= 0 && !DEFAULT_MODELS.includes(id)) {
                    MODELS.splice(modelsIndex, 1);
               }

               const prefabIndex = PREFAB_IDS.indexOf(id);
               if (prefabIndex >= 0 && !DEFAULT_PREFAB_IDS.includes(id)) {
                    PREFAB_IDS.splice(prefabIndex, 1);
               }

               delete MODEL_BLOBS[id];
               delete customTextureUrls[id];

               return true;
          } catch (error) {
               console.error('[Cubeshot] Failed to remove model:', error);
               return false;
          }
     }

     getManifest(): CustomAssetManifest {
          return this.manifest;
     }
}

const customAssetStorage = new CustomAssetStorage();

const SCALES = {
     'CRATE': 6,
     'STACK': 6,
     'BARREL': 4,
     'VEHICLE': 20,
}

const BASE_WORLD_UV = 60;
let currentMapScale = 1.0;

/** Get the current effective WORLD_UV based on map scale */
function getWorldUV(): number {
     return BASE_WORLD_UV * currentMapScale;
}

const AMBIENT_RATIO = 0.6;

const POSITION_VERTEX_SHADER = /*glsl*/`
     varying vec3 vPos;
`;

/** Generate texture vertex shader with current WORLD_UV value */
function getTextureVertexShader(): string {
     const worldUV = getWorldUV();
     return /*glsl*/ `
#include <uv_vertex>

// Extract scale from instance matrix
vec3 instanceScale = vec3(
     length(instanceMatrix[0].xyz),
     length(instanceMatrix[1].xyz),
     length(instanceMatrix[2].xyz)
);

vec3 absNormal = abs(normal);
vec2 scaleUV = vec2(1.0);
float worldUV = ${worldUV}.0;

if (absNormal.y > 0.5) {
     scaleUV = instanceScale.xz; // Top/Bottom
} else if (absNormal.z > 0.5) {
     scaleUV = instanceScale.xy; // Front/Back
} else {
     scaleUV = instanceScale.zy; // Left/Right
}

// Apply scaling to UVs
#ifdef USE_MAP
     vMapUv = uv * (scaleUV / worldUV);
#else
     vUv = uv * (scaleUV / worldUV);
#endif
`;
}

const _position = new Vector3();
const _quaternion = new Quaternion();
const _euler = new Euler
const _scale = new Vector3();
const _scale2 = new Vector3();
const _matrix = new Matrix4();

function setAABBFromCenterQuatSize(box: Box3, center: Vector3, quat: Quaternion, size: Vector3) {

     const halfSize = new Vector3().copy(size).multiplyScalar(0.5);

     // Local axes of the box, rotated by quat
     const xAxis = new Vector3(1, 0, 0).applyQuaternion(quat).multiplyScalar(halfSize.x);
     const yAxis = new Vector3(0, 1, 0).applyQuaternion(quat).multiplyScalar(halfSize.y);
     const zAxis = new Vector3(0, 0, 1).applyQuaternion(quat).multiplyScalar(halfSize.z);

     // AABB half-extents: sum of absolute projections of each axis
     const halfExtents = new Vector3(
          Math.abs(xAxis.x) + Math.abs(yAxis.x) + Math.abs(zAxis.x),
          Math.abs(xAxis.y) + Math.abs(yAxis.y) + Math.abs(zAxis.y),
          Math.abs(xAxis.z) + Math.abs(yAxis.z) + Math.abs(zAxis.z)
     );

     const aabbSize = halfExtents.clone().multiplyScalar(2);

     box.setFromCenterAndSize(center, aabbSize);
}

function setOBBFromCenterQuatSize(obb: OBB, aabb: Box3, center: Vector3, quat: Quaternion, size: Vector3): void {
     obb.setFromCenterQuatSize(center, quat, size);
     setAABBFromCenterQuatSize(aabb, center, quat, size);
}


/**
 * Oriented Bounding Box (OBB) class that stores center, half-extents, and rotation.
 * Unlike Box3 (AABB), this properly represents rotated boxes.
 */
class OBB {
     center: Vector3 = new Vector3();
     halfSize: Vector3 = new Vector3();
     quaternion: Quaternion = new Quaternion();


     toArray(): OBBArray {
          return [
               this.center.x, this.center.y, this.center.z,
               this.halfSize.x, this.halfSize.y, this.halfSize.z,
               this.quaternion.x, this.quaternion.y, this.quaternion.z, this.quaternion.w
          ]
     }

     constructor() { }

     /**
      * Set the OBB from center, quaternion, and full size
      */
     setFromCenterQuatSize(center: Vector3, quat: Quaternion, size: Vector3): this {
          this.center.copy(center);
          this.quaternion.copy(quat);
          this.halfSize.copy(size).multiplyScalar(0.5);
          return this;
     }

     /**
      * Copy from another OBB
      */
     copy(other: OBB): this {
          this.center.copy(other.center);
          this.halfSize.copy(other.halfSize);
          this.quaternion.copy(other.quaternion);
          return this;
     }



     /**
      * Get the 8 corners of this OBB in world space
      */
     getCorners(target: Vector3[]): Vector3[] {
          const corners = target.length >= 8 ? target : [];

          // Create 8 corners from -halfSize to +halfSize
          const signs = [
               [-1, -1, -1], [+1, -1, -1], [+1, -1, +1], [-1, -1, +1],
               [-1, +1, -1], [+1, +1, -1], [+1, +1, +1], [-1, +1, +1]
          ];

          for (let i = 0; i < 8; i++) {
               const corner = corners[i] || new Vector3();
               const s = signs[i]!;
               corner.set(
                    this.halfSize.x * s[0]!,
                    this.halfSize.y * s[1]!,
                    this.halfSize.z * s[2]!
               );
               corner.applyQuaternion(this.quaternion);
               corner.add(this.center);
               corners[i] = corner;
          }

          return corners;
     }
}




class TextureManager {
     private textures: Map<string, Texture> = new Map();
     private materials: Map<string, MeshStandardMaterial> = new Map();

     public getTexture(id: string, resolve?: () => void): Texture | null {
          if (id.toLowerCase() === "default") return null;

          if (!this.textures.has(id)) {
               const url = getTextureUrl(id);
               const texture = loadTexture(url, (tex) => {
                    // Update any materials using this texture
                    this.materials.forEach(mat => {
                         if (mat.userData.textureId === id) {
                              mat.map = tex;
                              mat.needsUpdate = true;
                         }
                    });
                    resolve?.();
               });
               this.textures.set(id, texture);
          }

          return this.textures.get(id) as Texture;
     }

     public getMaterial(textureId: string, options: Partial<MeshStandardMaterial> = {}, resolve?: () => void): MeshStandardMaterial {

          const key = textureId

          if (!this.materials.has(key)) {

               const material = new MeshStandardMaterial({
                    roughness: 1,
                    flatShading: true,
                    metalness: 0,
                    vertexColors: true,
                    map: this.getTexture(textureId, resolve),
                    ...options
               });

               material.vertexColors = options.vertexColors ?? true;

               material.userData.textureId = textureId;

               this.materials.set(key, material);
          }

          return this.materials.get(key) as MeshStandardMaterial;
     }
}

const textureManager = new TextureManager();


export class CubeTextureGroup {
     public mesh: InstancedMesh;

     private cubes: Set<CSCubeObject> = new Set();

     public map: Map<CSCubeObject, number> = new Map();

     private indexToCube: Map<number, CSCubeObject> = new Map();

     private material: MeshStandardMaterial;
     private geometry: BoxGeometry;

     constructor(
          public textureId: string,
          public capacity: number = 100
     ) {
          this.geometry = new BoxGeometry(1, 1, 1);
          this.geometry.computeBoundingBox();
          this.bakeVertexColors();

          this.material = this.createMaterial();

          this.mesh = new InstancedMesh(this.geometry, this.material, this.capacity);
          this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
          this.mesh.castShadow = true;
          this.mesh.receiveShadow = true;
          this.mesh.frustumCulled = false;
     }

     private createMaterial(): MeshStandardMaterial {
          const base = textureManager.getMaterial(this.textureId);
          const material = base.clone();

          material.onBeforeCompile = (shader) => {
               shader.vertexShader = POSITION_VERTEX_SHADER + shader.vertexShader;
               shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', getTextureVertexShader());
          };

          material.vertexColors = true;
          return material;
     }

     /** Rebuild the material with updated WORLD_UV value (called when map scale changes) */
     public rebuildMaterial() {
          const oldMaterial = this.material;
          this.material = this.createMaterial();
          this.mesh.material = this.material;

          // Force shader recompilation by invalidating the material
          this.material.needsUpdate = true;

          // Dispose old material
          oldMaterial.dispose();
     }

     private bakeVertexColors() {
          const colors = [];
          const position = this.geometry.getAttribute('position');
          const count = position.count;

          for (let i = 0; i < count; i++) {
               const y = position.getY(i);
               const c = y > 0 ? 1.0 : AMBIENT_RATIO;
               colors.push(c, c, c);
          }

          this.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
     }

     public add(cube: CSCubeObject) {
          // Check existence using the Set (O(1))
          if (this.cubes.has(cube)) {
               this.updateCube(cube);
               return;
          }

          if (this.cubes.size >= this.capacity) {
               this.expand();
          }

          // The new index is the current size of the set
          const index = this.cubes.size;

          // Add to Set
          this.cubes.add(cube);

          // Update Mappings
          this.map.set(cube, index);
          this.indexToCube.set(index, cube);

          this.updateCube(cube);

          this.mesh.count = this.cubes.size;
          this.mesh.instanceMatrix.needsUpdate = true;
          if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
     }

     public remove(cube: CSCubeObject) {
          if (!this.cubes.has(cube)) return;

          const index = this.map.get(cube);
          if (index === undefined) return;

          // Get the last index
          const lastIndex = this.cubes.size - 1;

          // Retrieve the object currently at the last index using our helper Map
          const lastCube = this.indexToCube.get(lastIndex);

          if (!lastCube) {
               console.error(`[Cubeshot] Failed to remove cube: No cube found at index ${lastIndex}`);
               return;
          }

          // Swap Logic (Move last item into the hole of the removed item)
          if (index !== lastIndex) {
               const matrix = new Matrix4();
               const color = new Color();

               // Copy data from last position to 'index'
               this.mesh.getMatrixAt(lastIndex, matrix);
               this.mesh.setMatrixAt(index, matrix);

               this.mesh.getColorAt(lastIndex, color);
               this.mesh.setColorAt(index, color);

               // Update Mappings for the moved cube (lastCube)
               this.map.set(lastCube, index);
               this.indexToCube.set(index, lastCube);

               this.mesh.instanceMatrix.needsUpdate = true;
               if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
          }

          // Remove the target cube
          this.cubes.delete(cube);
          this.map.delete(cube);

          // Remove the reference to the last index (it's either gone, or moved to 'index')
          this.indexToCube.delete(lastIndex);

          this.mesh.count = this.cubes.size;
          this.mesh.instanceMatrix.needsUpdate = true;
     }

     public updateCube(cube: CSCubeObject) {
          const index = this.map.get(cube);
          if (index === undefined) return;

          cube.updateWorldMatrix(true, false);
          cube.matrixWorld.decompose(_position, _quaternion as any, _scale); // Cast for placeholder types

          _position.y += cube.scale.y / 2;

          _matrix.makeRotationFromQuaternion(_quaternion as any);

          if (!cube.visible) {
               _matrix.scale(new Vector3(0.0001, 0.0001, 0.0001));
          } else {
               _matrix.scale(_scale);
          }
          _matrix.setPosition(_position);

          this.mesh.setMatrixAt(index, _matrix);

          const color = new Color(cube.color);
          const intensity = 1.0 - (cube.darken * 0.5);
          color.multiplyScalar(intensity);

          this.mesh.setColorAt(index, color);

          this.mesh.instanceMatrix.needsUpdate = true;
          if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
     }

     private expand() {
          const newCapacity = this.capacity * 2;
          const newMesh = new InstancedMesh(this.geometry, this.material, newCapacity);

          newMesh.frustumCulled = false;
          newMesh.castShadow = true;
          newMesh.receiveShadow = true;
          newMesh.instanceMatrix.setUsage(DynamicDrawUsage);

          // Copy existing data buffers
          newMesh.instanceMatrix.array.set(this.mesh.instanceMatrix.array);
          if (this.mesh.instanceColor && newMesh.instanceColor) {
               newMesh.instanceColor.array.set(this.mesh.instanceColor.array);
          }

          newMesh.count = this.mesh.count;

          if (this.mesh.parent) {
               this.mesh.parent.add(newMesh);
               this.mesh.parent.remove(this.mesh);
          }

          this.mesh.dispose();
          this.mesh = newMesh;
          this.capacity = newCapacity;
     }
}

class UnifiedGeometryManager {
     private groups: Map<string, CubeTextureGroup> = new Map();
     private scene: Scene | undefined;

     setScene(scene: Scene) {
          this.scene = scene;
     }

     register(cube: CSCubeObject) {
          if (!this.scene && cube.store?.scene) this.scene = cube.store.scene;

          const texture = cube.texture || 'DEFAULT';
          let group = this.groups.get(texture);

          if (!group) {
               group = new CubeTextureGroup(texture);
               this.groups.set(texture, group);
               this.scene?.add(group.mesh);
          }

          group.add(cube);
          this.updateVisibility(cube);
     }

     updateVisibility(cube: CSCubeObject) {
          // Visibility is now handled directly in updateCube by scaling to near-zero
          // Just trigger a full update to apply visibility change
          this.update(cube);
     }

     update(cube: CSCubeObject) {

          // Check if texture changed, if so move groups
          const texture = cube.texture || 'DEFAULT';

          // Find current group
          let currentGroup: CubeTextureGroup | undefined;

          for (const [key, group] of this.groups.entries()) {

               if (group.map.has(cube)) {

                    currentGroup = group;

                    if (key !== texture) {

                         group.remove(cube)
                         this.register(cube);
                         return;
                    }

                    break;
               }
          }

          if (!currentGroup) {
               this.register(cube);
               return;
          }

          currentGroup.updateCube(cube);
     }

     getGroup(cube: CSCubeObject): CubeTextureGroup | undefined {
          for (const group of this.groups.values()) {
               if (group.map.has(cube)) {
                    return group;
               }
          }
          return undefined;
     }

     remove(cube: CSCubeObject) {
          for (const group of this.groups.values()) {
               if (group.map.has(cube)) {
                    group.remove(cube);
                    break;
               }
          }
     }

     /** Rebuild all materials for all groups (called when map scale changes) */
     rebuildAllMaterials() {
          for (const group of this.groups.values()) {
               group.rebuildMaterial();
          }
     }
}

const geometryManager = new UnifiedGeometryManager();

class BatchedBox3HelperManager {
     private objects: ICSObject[] = [];
     private map: Map<ICSObject, number> = new Map();
     private lineSegments: LineSegments | undefined;
     private scene: Scene | undefined;
     private capacity: number = 100;
     private geometry: BufferGeometry | undefined;
     private material: LineBasicMaterial | undefined;
     private positionAttribute: BufferAttribute | undefined;
     private colorAttribute: BufferAttribute | undefined;

     // 12 edges per box, 2 vertices per edge = 24 vertices per box
     private readonly VERTICES_PER_BOX = 24;

     // Cached corners array for OBB rendering
     private readonly _corners: Vector3[] = Array.from({ length: 8 }, () => new Vector3());

     setScene(scene: Scene) {
          this.scene = scene;
          if (!this.lineSegments) this.build();
     }

     private build() {
          if (this.lineSegments) {
               this.lineSegments.removeFromParent();
               this.lineSegments.geometry.dispose();
          }

          this.geometry = new BufferGeometry();

          // Pre-allocate arrays for capacity boxes
          const positionArray = new Float32Array(this.capacity * this.VERTICES_PER_BOX * 3);
          const colorArray = new Float32Array(this.capacity * this.VERTICES_PER_BOX * 3);

          this.positionAttribute = new BufferAttribute(positionArray, 3);
          this.positionAttribute.setUsage(DynamicDrawUsage);

          this.colorAttribute = new BufferAttribute(colorArray, 3);
          this.colorAttribute.setUsage(DynamicDrawUsage);

          this.geometry.setAttribute('position', this.positionAttribute);
          this.geometry.setAttribute('color', this.colorAttribute);

          this.material = new LineBasicMaterial({
               vertexColors: true,
               transparent: true,
               opacity: 0.9,
               depthTest: true,
               depthWrite: false
          });

          this.lineSegments = new LineSegments(this.geometry, this.material);
          this.lineSegments.frustumCulled = false;
          this.lineSegments.name = 'BatchedBox3Helpers';

          if (this.scene) this.scene.add(this.lineSegments);

          // Rebuild all existing objects
          this.objects.forEach(obj => this.updateObject(obj));
          this.updateDrawRange();
     }

     private updateDrawRange() {
          if (this.geometry) {
               this.geometry.setDrawRange(0, this.objects.length * this.VERTICES_PER_BOX);
          }
     }

     register(object: ICSObject) {
          if (!this.scene && object.store?.scene) {
               this.scene = object.store.scene;
               if (!this.lineSegments) this.build();
          }

          if (!this.scene) return;
          if (this.map.has(object)) return;

          if (this.objects.length >= this.capacity) {
               this.expand();
          }

          const index = this.objects.length;
          this.objects.push(object);
          this.map.set(object, index);

          this.updateObject(object);
          this.updateDrawRange();
     }

     update(object: ICSObject) {
          if (!this.map.has(object)) return;
          this.updateObject(object);
     }

     private updateObject(object: ICSObject) {
          const index = this.map.get(object);
          if (index === undefined || !this.positionAttribute || !this.colorAttribute || !object.bound) return;

          // Get the 8 corners of the OBB
          const corners = object.obb.getCorners(this._corners);

          // Base vertex index for this box
          const baseVertex = index * this.VERTICES_PER_BOX;
          const positions = this.positionAttribute.array as Float32Array;
          const colors = this.colorAttribute.array as Float32Array;

          // Get color for this object
          const colorHex = this.getColorForObject(object);
          const r = ((colorHex >> 16) & 255) / 255;
          const g = ((colorHex >> 8) & 255) / 255;
          const b = (colorHex & 255) / 255;

          // 12 edges of a box (each edge = 2 vertices = 6 floats for position, 6 for color)
          let v = baseVertex * 3;
          let c = baseVertex * 3;

          // Helper to add an edge using corner indices
          const addEdgeFromCorners = (i1: number, i2: number) => {
               const c1 = corners[i1]!;
               const c2 = corners[i2]!;
               positions[v++] = c1.x; positions[v++] = c1.y; positions[v++] = c1.z;
               positions[v++] = c2.x; positions[v++] = c2.y; positions[v++] = c2.z;
               colors[c++] = r; colors[c++] = g; colors[c++] = b;
               colors[c++] = r; colors[c++] = g; colors[c++] = b;
          };

          // Corner indices (based on OBB.getCorners ordering):
          // Bottom face: 0, 1, 2, 3 (y = -halfSize.y)
          // Top face: 4, 5, 6, 7 (y = +halfSize.y)

          // Bottom face edges
          addEdgeFromCorners(0, 1);
          addEdgeFromCorners(1, 2);
          addEdgeFromCorners(2, 3);
          addEdgeFromCorners(3, 0);

          // Top face edges
          addEdgeFromCorners(4, 5);
          addEdgeFromCorners(5, 6);
          addEdgeFromCorners(6, 7);
          addEdgeFromCorners(7, 4);

          // Vertical edges (connecting bottom to top)
          addEdgeFromCorners(0, 4);
          addEdgeFromCorners(1, 5);
          addEdgeFromCorners(2, 6);
          addEdgeFromCorners(3, 7);

          this.positionAttribute.needsUpdate = true;
          this.colorAttribute.needsUpdate = true;
     }

     remove(object: ICSObject) {
          const index = this.map.get(object);
          if (index === undefined) return;

          const lastIndex = this.objects.length - 1;
          const lastObject = this.objects[lastIndex];

          if (!lastObject) return;

          if (index !== lastIndex && this.positionAttribute && this.colorAttribute) {
               // Swap with last - copy position and color data
               this.objects[index] = lastObject;
               this.map.set(lastObject, index);

               const positions = this.positionAttribute.array as Float32Array;
               const colors = this.colorAttribute.array as Float32Array;

               const srcStart = lastIndex * this.VERTICES_PER_BOX * 3;
               const dstStart = index * this.VERTICES_PER_BOX * 3;
               const count = this.VERTICES_PER_BOX * 3;

               for (let i = 0; i < count; i++) {
                    positions[dstStart + i] = positions[srcStart + i] ?? 0;
                    colors[dstStart + i] = colors[srcStart + i] ?? 0;
               }

               this.positionAttribute.needsUpdate = true;
               this.colorAttribute.needsUpdate = true;
          }

          this.objects.pop();
          this.map.delete(object);
          this.updateDrawRange();
     }

     private expand() {
          this.capacity *= 2;

          if (!this.positionAttribute || !this.colorAttribute || !this.geometry) {
               this.build();
               return;
          }

          // Create new larger arrays
          const newPositionArray = new Float32Array(this.capacity * this.VERTICES_PER_BOX * 3);
          const newColorArray = new Float32Array(this.capacity * this.VERTICES_PER_BOX * 3);

          // Copy existing data
          newPositionArray.set(this.positionAttribute.array);
          newColorArray.set(this.colorAttribute.array);

          // Create new attributes
          this.positionAttribute = new BufferAttribute(newPositionArray, 3);
          this.positionAttribute.setUsage(DynamicDrawUsage);

          this.colorAttribute = new BufferAttribute(newColorArray, 3);
          this.colorAttribute.setUsage(DynamicDrawUsage);

          this.geometry.setAttribute('position', this.positionAttribute);
          this.geometry.setAttribute('color', this.colorAttribute);
     }

     private getColorForObject(object: ICSObject): number {
          // Blue if invisible
          if (!object.visible) return 0x0000FF;

          // Different colors for different object types
          if (object instanceof CSCubeObject) return 0xFFFF00; // Yellow
          if (object instanceof CSPlaneObject) return 0x00FFFF; // Cyan
          if (object instanceof CSLadderObject) return 0xFFA500; // Orange
          if (object instanceof CSSpawnPointObject) return 0x00FF00; // Green
          if (object instanceof CSDeathZoneObject) return 0xFF0000; // Red

          return 0xFFFF00; // Default yellow
     }
}

const helperManager = new BatchedBox3HelperManager();


function syncTransform(from: Object3D, to: Object3D) {
     from.matrixWorld.decompose(to.position, to.quaternion, to.scale);

     to.visible = from.visible;
     to.matrixWorldNeedsUpdate = true;
     from.matrixWorldNeedsUpdate = true;
}

function makeStandardMaterial(color: number, opts?: MeshStandardMaterialParameters) {
     const params = Object.assign({
          color,
          roughness: 0.9,
          metalness: 0.0,
          vertexColors: true,
     }, opts || {});
     return new MeshStandardMaterial(params);
}

// DO NOT call update components on component changes, it will cause a loop
// The updating the components call the update event.
abstract class ICSObject extends CustomObject3D {

     public collision: boolean = true;
     public obb: OBB = new OBB();

     constructor() {
          super();
          this.bound = new Box3();
     }

     /** Common initialization logic for all CS objects. Returns false if headless. */
     protected initBase(store?: StoreAdapter): boolean {
          this.store = store || this.store;
          if (this.headless) return false;
          initHelperScene(store);
          return true;
     }

     public fromMapObject(data: MapObject): void {
          if ("p" in data) this.position.fromArray(data.p);
          if ("s" in data) this.scale.fromArray(data.s);
          if ("r" in data) this.rotation.fromArray(data.r as [x: number, y: number, z: number]);
          if ("v" in data) this.visible = data.v == 1 ? false : true;
     }

     public toMapObject(id: string): MapObject {

          this.matrixWorld.decompose(_position, _quaternion, _scale);

          _euler.setFromQuaternion(_quaternion, this.rotation.order);

          return {
               id: id,
               i: PREFAB_IDS.indexOf(id),
               p: _position.toArray(),
               s: _scale.toArray(),
               r: _euler.toArray() as [x: number, y: number, z: number],
               v: this.visible ? 1 : 0,
               col: this.collision ? 0 : 1,
               obb: this.obb.toArray(),
          };
     }

     public updateBound() {
          if (!this.bound) return;

          this.matrixWorld.decompose(_position, _quaternion, _scale);

          // Set OBB from center, quaternion, and scale
          setOBBFromCenterQuatSize(this.obb, this.bound, _position, _quaternion, _scale);
     }

     override update(): void {
          this.updateMatrix();
          this.updateMatrixWorld(false);
          this.updateBound();
          helperManager.update(this);
     }


     destroy(): void {
          helperManager.remove(this);
     }

}

class CSCubeObject extends ICSObject {
     static override type: string = 'CubeShotCube';
     static override icon: [string, string] = ['uil uil-cube', '#4CAF50'];

     override icon: [string, string] = [`${ORIGIN}/textures/wall_0.png`, '#4CAF50'];
     override type = CSCubeObject.type;

     public color: number = 0x9E9E9E;
     private _texture: string = 'WALL';

     public get texture(): string {
          return this._texture;
     }

     public set texture(value: string) {

          if (value == this._texture) return;
          this._texture = value;

          this.icon = [getTextureUrl(value), '#4CAF50'];

          this.textureOption?.update(TEXTURE_IDS.indexOf(value));
     }
     public darken: number = 0;

     private widthOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private heightOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private depthOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private colorOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     public textureOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private darkenOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private collisionOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private castShadowOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private receiveShadowOption: ReturnType<this["createComponentOption"]> | undefined = undefined;

     private lastMatrix = new Matrix4();
     private lastColor: number = -1;
     private lastDarken: number = -1;
     private lastVisible: boolean = false;
     private lastTexture: string = '';

     constructor() {
          super();
          this.name = 'Cube';
          this.scale.set(10, 10, 10);
          this.castShadow = true;
          this.receiveShadow = true;

          // Hide default scale controls since we use Width/Height/Depth instead
          // Also hide castShadow/receiveShadow since we have custom controls
          this.defaults = {
               scale: false,
               castShadow: false,
               receiveShadow: false,
               frustumCulled: false,
          };
     }

     private createComponents() {

          const component = this.createComponent('Cube', 'uil uil-cube');

          this.widthOption = component?.createComponentOption('Width', this.scale.x, 'number', { min: 0.01, max: 1000, step: 0.1 })
               ?.then(c => { this.scale.x = c.value }) as ReturnType<this["createComponentOption"]>;

          this.heightOption = component?.createComponentOption('Height', this.scale.y, 'number', { min: 0.01, max: 1000, step: 0.1 })
               ?.then(c => { this.scale.y = c.value }) as ReturnType<this["createComponentOption"]>

          this.depthOption = component?.createComponentOption('Depth', this.scale.z, 'number', { min: 0.01, max: 1000, step: 0.1 })
               ?.then(c => { this.scale.z = c.value }) as ReturnType<this["createComponentOption"]>;

          this.colorOption = component?.createComponentOption('Color', this.color, 'color')
               ?.then(c => { this.color = c.value }) as ReturnType<this["createComponentOption"]>;

          this.textureOption = component?.createComponentOption('Texture', TEXTURE_IDS.indexOf(this.texture), 'select', { options: TEXTURE_IDS })
               ?.then(c => { this.texture = TEXTURE_IDS[c.value] ?? this.texture; }) as ReturnType<this["createComponentOption"]>;

          this.darkenOption = component?.createComponentOption('Darken', this.darken, 'number', { min: 0, max: 1, step: 0.05 })
               ?.then(c => { this.darken = c.value }) as ReturnType<this["createComponentOption"]>;

          this.collisionOption = component?.createComponentOption('Collision', this.collision, 'boolean')
               ?.then(c => { this.collision = !!c.value }) as ReturnType<this["createComponentOption"]>;

          // this.castShadowOption = component?.createComponentOption('Cast Shadow', this.castShadow, 'boolean')
          //      ?.then(c => { this.castShadow = !!c.value; }) as ReturnType<this["createComponentOption"]>;

          // this.receiveShadowOption = component?.createComponentOption('Receive Shadow', this.receiveShadow, 'boolean')
          //      ?.then(c => { this.receiveShadow = !!c.value; }) as ReturnType<this["createComponentOption"]>;
     }

     private updateComponents() {
          this.widthOption?.update(this.scale.x);
          this.heightOption?.update(this.scale.y);
          this.depthOption?.update(this.scale.z);
          this.colorOption?.update(this.color);
          this.textureOption?.update(TEXTURE_IDS.indexOf(this.texture));
          this.darkenOption?.update(this.darken);
          this.collisionOption?.update(this.collision);
          this.castShadowOption?.update(this.castShadow);
          this.receiveShadowOption?.update(this.receiveShadow);
          this.updateBound();
     }

     create() {
          if (!isStoreReady(this)) return;
          // Register with managers only after object is added to scene
          if (!geometryManager.getGroup(this)) {
               geometryManager.register(this);
          }
          this.rebuild();
     }

     private rebuild(updateComponents: boolean = true) {
          if (!isStoreReady(this)) return;
          geometryManager.update(this);
          helperManager.update(this);
          if (updateComponents) this.updateComponents();
     }

     override init(store?: StoreAdapter): void {
          if (!this.initBase(store)) return;

          this.createComponents();
          // Note: geometryManager.register is called in create() after object is added to scene
          helperManager.register(this);
     }

     public override updateBound() {
          if (!this.bound) return;

          // this.updateWorldMatrix( true, false );

          this.matrixWorld.decompose(_position, _quaternion, _scale);

          _position.y += this.scale.y / 2;

          setOBBFromCenterQuatSize(this.obb, this.bound, _position, _quaternion, _scale);
     }

     override update(): void {

          if (!this.parent) return this.destroy();

          this.updateMatrix();

          super.update();

          const needsUpdate = !this.matrixWorld.equals(this.lastMatrix) ||
               this.color !== this.lastColor ||
               this.darken !== this.lastDarken ||
               this.visible !== this.lastVisible ||
               this.texture !== this.lastTexture;

          if (needsUpdate) {
               this.rebuild(false);
               geometryManager.update(this);
               helperManager.update(this);
               this.lastMatrix.copy(this.matrixWorld);
               this.lastColor = this.color;
               this.lastDarken = this.darken;
               this.lastVisible = this.visible;
               this.lastTexture = this.texture;
          }

          this.updateBound();
     }

     override destroy(): void {
          geometryManager.remove(this);
          helperManager.remove(this);
     }

     public override toMapObject(): MapObject {

          return {
               ...super.toMapObject('CUBE'),
               t: this.texture,
               color: this.color,
               da: this.darken
          };
     }

     public override fromMapObject(data: MapObject): void {
          super.fromMapObject(data);
          if (data.s) this.scale.fromArray(data.s);
          if (data.t) this.texture = data.t;
          if (data.col !== undefined) this.collision = data.col === 1;
          if (data.color !== undefined) this.color = data.color;
          if (data.da !== undefined) this.darken = data.da;
          this.updateComponents();
          this.rebuild();
     }

     override toJSON() {

          const json = super.toJSON();

          return Object.assign(json, {
               cubeshot: {
                    color: this.color,
                    texture: this.texture,
                    darken: this.darken,
                    collision: this.collision
               }
          });
     }

     override fromJSON(json: Awaited<ReturnType<CSCubeObject["toJSON"]>>): void {


          if (json.cubeshot) {
               this.color = json.cubeshot.color || 0x9E9E9E;
               this.texture = json.cubeshot.texture || 'DEFAULT';
               this.darken = json.cubeshot.darken || 0;
               this.collision = json.cubeshot.collision ?? true;
          }
     }

     override copy(source: Object3D, recursive?: boolean): this {
          super.copy(source, recursive);

          if (source instanceof CSCubeObject) {
               this.color = source.color;
               this.texture = source.texture;
               this.darken = source.darken;
               this.collision = source.collision;
          }

          return this;
     }
}

class CSPlaneObject extends ICSObject {
     static override type: string = 'CubeShotPlane';
     static override icon: [string, string] = ['uil uil-square', '#2196F3'];

     override icon = CSPlaneObject.icon;
     override type = CSPlaneObject.type;

     private mesh?: Mesh;

     // Properties
     private color: number = 0xAAAAAA;
     private texture: string = 'DEFAULT';
     private noise: number = 1; // Added noise property

     private widthOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private heightOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private colorOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private textureOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private noiseOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private collisionOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private receiveShadowOption: ReturnType<this["createComponentOption"]> | undefined = undefined;

     private lastNoise: number | undefined = undefined;
     private lastScaleX: number | undefined = undefined;
     private lastScaleZ: number | undefined = undefined;
     private lastTexture: string | undefined = undefined;
     private lastColor: number | undefined = undefined;

     constructor() {
          super();
          this.name = 'Plane';
          this.scale.set(10, 0.1, 10);
          this.receiveShadow = true;

          // Hide default controls - plane uses Width/Height custom controls and doesn't need rotation/scale
          this.defaults = {
               rotation: false,
               scale: false,
               castShadow: false,
               receiveShadow: false
          };
     }

     private createComponents() {
          const component = this.createComponent('Plane', 'uil uil-square');

          this.widthOption = component?.createComponentOption('Width', this.scale.x, 'number', { min: 0.1, max: 1000, step: 0.5 })
               ?.then(c => { this.scale.x = c.value ?? this.scale.x; }) as ReturnType<this["createComponentOption"]>;

          this.heightOption = component?.createComponentOption('Height', this.scale.z, 'number', { min: 0.1, max: 1000, step: 0.5 })
               ?.then(c => { this.scale.z = c.value ?? this.scale.z; }) as ReturnType<this["createComponentOption"]>;

          this.colorOption = component?.createComponentOption('Color', this.color, 'color')
               ?.then(c => { this.color = c.value ?? this.color; }) as ReturnType<this["createComponentOption"]>;

          this.textureOption = component?.createComponentOption('Texture', TEXTURE_IDS.indexOf(this.texture), 'select', { options: TEXTURE_IDS })
               ?.then(c => { this.texture = TEXTURE_IDS[c.value] ?? this.texture; }) as ReturnType<this["createComponentOption"]>;

          this.noiseOption = component?.createComponentOption('Noise', this.noise, 'number', { min: 0, max: 20, step: 0.5 })
               ?.then(c => { this.noise = c.value ?? this.noise; }) as ReturnType<this["createComponentOption"]>;

          this.collisionOption = component?.createComponentOption('Collision', this.collision, 'boolean')
               ?.then(c => { this.collision = !!c.value }) as ReturnType<this["createComponentOption"]>;

          this.receiveShadowOption = component?.createComponentOption('Receive Shadow', this.receiveShadow, 'boolean')
               ?.then(c => { this.receiveShadow = !!c.value; }) as ReturnType<this["createComponentOption"]>;
     }

     private updateComponents() {
          this.widthOption?.update(this.scale.x);
          this.heightOption?.update(this.scale.z);
          this.colorOption?.update(this.color);
          this.textureOption?.update(TEXTURE_IDS.indexOf(this.texture));
          this.noiseOption?.update(this.noise);
          this.collisionOption?.update(this.collision);
          this.receiveShadowOption?.update(this.receiveShadow);
          this.updateBound();
     }

     private discard() {
          if (!this.mesh) return;
          this.mesh.removeFromParent();
          this.mesh.geometry.dispose?.();
          this.mesh = undefined;
     }

     private rebuild() {
          if (!isStoreReady(this)) return;
          this.discard();

          const segmentsX = Math.max(1, Math.floor(this.scale.x / 8));
          const segmentsZ = Math.max(1, Math.floor(this.scale.z / 8));

          const geo = new PlaneGeometry(this.scale.x, this.scale.z, segmentsX, segmentsZ);

          const posAttribute = geo.attributes.position;

          if (!posAttribute) return;

          const count = posAttribute.count;

          // Pre-allocate color attribute
          const colors = new Float32Array(count * 3);
          const baseColor = new Color(this.color);
          const darkColor = baseColor.clone().multiplyScalar(0.65);

          const candidates: { x: number, z: number, w: number, l: number, y: number, h: number }[] = [];


          if (this.noise > 0 && this.store.customObjects) {

               const planeBox = new Box3().setFromCenterAndSize(
                    this.position,
                    new Vector3(this.scale.x, 1000, this.scale.z)
               );

               for (const obj of this.store.customObjects) {
                    if (obj === this) continue;
                    if (!obj.visible) continue;

                    if (obj instanceof CSCubeObject || obj instanceof CSMeshObject) {

                         if (!obj.bound) continue;

                         obj.updateWorldMatrix(true, false);

                         // Optimization: Only consider objects overlapping the plane area
                         // Use OBB's intersectsBox method (uses cached AABB for intersection)
                         if (obj.bound.intersectsBox(planeBox)) {
                              candidates.push({
                                   x: obj.position.x,
                                   z: obj.position.z,
                                   w: obj.scale.x / 2, // half-width
                                   l: obj.scale.z / 2, // half-length
                                   y: obj.position.y,
                                   h: obj.scale.y
                              });
                         }
                    }
               }
          }

          for (let i = 0; i < count; i++) {

               const lx = posAttribute.getX(i);
               const ly = posAttribute.getY(i);

               // Note: Since the mesh is rotated -90 deg X, Local Y maps to World -Z.
               const wx = this.position.x + lx;
               const wz = this.position.z - ly;

               let displacement = 0;
               let isDark = false;

               if (this.noise > 0) {
                    // Check against candidates
                    for (const obj of candidates) {
                         // pointInRect(x, y, x2, y2, w, l)
                         // (x >= x2 - w && x <= x2 + w && y >= y2 - l && y <= y2 + l)
                         const margin = 3; // data.margin usually 0

                         if (wx >= obj.x - obj.w - margin &&
                              wx <= obj.x + obj.w + margin &&
                              wz >= obj.z - obj.l - margin &&
                              wz <= obj.z + obj.l + margin) {

                              displacement = (Math.random() * this.noise) + 1;
                              isDark = true;
                              break; // First hit wins
                         }
                    }
               }

               // Apply displacement
               // In PlaneGeometry (XY), Z is the normal/height.
               if (displacement > 0) {
                    posAttribute.setZ(i, displacement);
               }

               const c = isDark ? darkColor : baseColor;
               colors[i * 3] = c.r;
               colors[i * 3 + 1] = c.g;
               colors[i * 3 + 2] = c.b;
          }

          geo.setAttribute('color', new BufferAttribute(colors, 3));
          posAttribute.needsUpdate = true;

          // 3. Handle UVs (Scaling)
          const uvAttribute = geo.attributes.uv;
          if (uvAttribute) {
               const worldUV = getWorldUV();
               for (let i = 0; i < uvAttribute.count; i++) {
                    uvAttribute.setXY(
                         i,
                         uvAttribute.getX(i) * (this.scale.x / worldUV),
                         uvAttribute.getY(i) * (this.scale.z / worldUV)
                    );
               }
               uvAttribute.needsUpdate = true;
          }

          geo.computeVertexNormals();

          const mat = textureManager.getMaterial(this.texture, {
               vertexColors: true,
               flatShading: true
          });
          mat.side = DoubleSide;

          const mesh = new Mesh(geo, mat);
          mesh.receiveShadow = this.receiveShadow;
          mesh.castShadow = false;
          mesh.rotation.x = -Math.PI / 2;
          mesh.name = `${this.name}_Visual`;

          this.mesh = mesh;
          this.store.scene?.add(mesh);
          syncTransform(this, mesh);

          this.mesh.scale.set(1, 1, 1);

          this.updateComponents();
     }

     override create() {
          this.rebuild();
     }

     override init(store?: StoreAdapter): void {
          if (!this.initBase(store)) return;

          this.createComponents();
          helperManager.register(this);
          this.rebuild();
     }

     override update(): void {
          if (!this.parent) return this.destroy();

          // Check if any property that affects geometry/material has changed
          const needsRebuild =
               this.noise !== this.lastNoise ||
               this.scale.x !== this.lastScaleX ||
               this.scale.z !== this.lastScaleZ ||
               this.texture !== this.lastTexture ||
               this.color !== this.lastColor;

          if (needsRebuild) {
               this.lastNoise = this.noise;
               this.lastScaleX = this.scale.x;
               this.lastScaleZ = this.scale.z;
               this.lastTexture = this.texture;
               this.lastColor = this.color;
               this.rebuild();
          }

          super.update();

          if (this.mesh) {

               this.mesh.position.copy(this.position);
               this.mesh.quaternion.copy(this.quaternion);

               this.mesh.rotateX(-Math.PI / 2);

               // Display if terrain is enabled
               this.mesh.visible = this.noise > 0 ? true : this.visible;
          }
     }

     override destroy(): void {
          this.discard();
          helperManager.remove(this);
          super.destroy?.();
     }

     public override updateBound() {
          if (!this.bound) return;

          this.matrixWorld.decompose(_position, _quaternion, _scale);

          // For Y (Height), we need to account for the object's compressed Y scale (0.1).
          // If noise is present, we calculate the required local height to match the world noise height.
          const targetHeight = this.noise > 0 ? this.noise + 1 : 0.1;

          // Size is scale.x, targetHeight, scale.z (plane is in XZ plane)
          _scale2.set(_scale.x, targetHeight, _scale.z);

          // Offset center Y by half the height
          _position.y += targetHeight / 2;

          setOBBFromCenterQuatSize(this.obb, this.bound, _position, _quaternion, _scale2);
     }

     override toMapObject(): MapObject {
          return {
               ...super.toMapObject('PLANE'),
               t: this.texture,
               color: this.color,
               ter: this.noise,
          };
     }

     override fromMapObject(data: MapObject): void {
          super.fromMapObject(data);
          if (data.t) this.texture = data.t;
          if (data.col !== undefined) this.collision = data.col === 1;
          if (data.color !== undefined) this.color = data.color;
          if (data.ter !== undefined) this.noise = data.ter;
          this.updateComponents();
          this.rebuild();
     }

     override toJSON() {
          const json = super.toJSON();

          return Object.assign(json, {
               cubeshot: {
                    color: this.color,
                    texture: this.texture,
                    noise: this.noise,
                    collision: this.collision
               }
          });
     }

     override fromJSON(json: Awaited<ReturnType<CSPlaneObject["toJSON"]>>): void {


          if (json.cubeshot) {
               this.color = json.cubeshot.color || 0xAAAAAA;
               this.texture = json.cubeshot.texture || 'DEFAULT';
               this.noise = json.cubeshot.noise || 0;
               this.collision = json.cubeshot.collision ?? true;
          }
     }

     override copy(source: Object3D, recursive?: boolean): this {
          super.copy(source, recursive);

          if (source instanceof CSPlaneObject) {
               this.color = source.color;
               this.texture = source.texture;
               this.noise = source.noise;
               this.collision = source.collision;
          }

          return this;
     }
}

const LADDER_WIDTH = 3.2;
const LADDER_SCALE = 0.5;
const STEP_HEIGHT = 6;

class CSLadderObject extends ICSObject {
     static override type: string = 'CubeShotLadder';
     static override icon: [string, string] = ['uil uil-apps', '#FFC107'];

     override icon = CSLadderObject.icon;
     override type = CSLadderObject.type;

     private group?: Group;
     private direction: number = 0;

     private heightOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private directionOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private collisionOption: ReturnType<this["createComponentOption"]> | undefined = undefined;

     constructor() {
          super();
          this.name = 'Ladder';
          this.scale.set(1, 10, 1);
          this.castShadow = true;
     }

     private createComponents() {
          const comp = this.createComponent('Ladder', 'uil uil-apps');

          this.heightOption = comp?.createComponentOption('Height', this.scale.y, 'number', { min: STEP_HEIGHT, max: 100, step: STEP_HEIGHT })
               ?.then(c => { this.scale.y = c.value }) as ReturnType<this["createComponentOption"]>;

          this.directionOption = comp?.createComponentOption('Direction', this.direction, 'number', { min: 0, max: 3, step: 1 })
               ?.then(c => { this.direction = c.value ?? this.direction; }) as ReturnType<this["createComponentOption"]>;

          this.collisionOption = comp?.createComponentOption('Collision', this.collision, 'boolean')
               ?.then(c => { this.collision = !!c.value }) as ReturnType<this["createComponentOption"]>;
     }

     private updateComponents() {
          this.heightOption?.update(this.scale.y);
          this.directionOption?.update(this.direction);
          this.collisionOption?.update(this.collision);
          this.updateBound();
     }

     private disposeGroup() {
          if (!this.group) return;
          this.group.removeFromParent();
          this.group = undefined;
     }

     public override updateBound() {
          if (!this.bound) return;

          this.matrixWorld.decompose(_position, _quaternion, _scale);

          const visualHeight = this.scale.y + 2;
          const width = (LADDER_WIDTH * 2) + (LADDER_SCALE * 2);
          const depth = LADDER_SCALE * 2;

          // Visual ignores object rotation, uses direction
          _quaternion.setFromAxisAngle(new Vector3(0, 1, 0), this.direction * Math.PI / 2);

          _position.y += visualHeight / 2;

          _scale.set(depth, visualHeight, width);

          setOBBFromCenterQuatSize(this.obb, this.bound, _position, _quaternion, _scale);
     }

     override create() {
          this.rebuild();
     }

     private rebuild() {
          if (!isStoreReady(this)) return;
          this.disposeGroup();

          const group = new Group();
          const mat = makeStandardMaterial(0x8B8B8B);
          const rungMat = makeStandardMaterial(0xC0C0C0);

          // Rails are at +/- ladderWidth along the axis perpendicular to direction
          // d=0 means rails at Z offsets (ladder faces X)

          const railGeo = new BoxGeometry(LADDER_SCALE * 2, this.scale.y + 2, LADDER_SCALE * 2);
          const leftRail = new Mesh(railGeo, mat);
          const rightRail = new Mesh(railGeo, mat);

          // d=0 alignment: rails at Z = +/- LADDER_WIDTH
          leftRail.position.set(0, (this.scale.y + 2) / 2, -LADDER_WIDTH);
          rightRail.position.set(0, (this.scale.y + 2) / 2, +LADDER_WIDTH);

          leftRail.castShadow = true;
          rightRail.castShadow = true;

          group.add(leftRail, rightRail);

          const rungCount = Math.floor(this.scale.y / STEP_HEIGHT);
          // Rung width = LADDER_WIDTH * 2
          // Rung height (visual length) = LADDER_SCALE * 2
          const rungGeo = new PlaneGeometry(LADDER_WIDTH * 2, LADDER_SCALE * 2);

          for (let i = 0; i < rungCount; i++) {
               const y = STEP_HEIGHT * (i + 1);
               if (y > this.scale.y) break;

               const rung = new Mesh(rungGeo, rungMat);
               rung.position.set(0, y, 0);

               // Rotate to be vertical in YZ plane
               rung.rotation.y = Math.PI / 2;

               rung.castShadow = true;

               // Rungs need to be double sided to be seen from back? 
               rungMat.side = DoubleSide;

               group.add(rung);
          }

          this.group = group;
          this.store.scene?.add(group);

          // Manual sync to avoid scale issues
          this.group.position.copy(this.position);
          // this.group.quaternion.copy(this.quaternion);
          group.rotation.y = this.direction * Math.PI / 2;
          this.group.scale.set(1, 1, 1);
          this.group.visible = this.visible;

          this.updateComponents();
     }

     override init(store?: StoreAdapter): void {
          if (!this.initBase(store)) return;

          this.createComponents();
          helperManager.register(this);
          this.rebuild();
     }

     override update(): void {
          if (!this.parent) return this.destroy();

          // Force scale to represent bounds
          // d=0 (along Z): X=thickness, Z=width
          // d=1 (along X): X=width, Z=thickness
          const isZ = this.direction % 2 === 0;
          const width = (LADDER_WIDTH * 2) + (LADDER_SCALE * 2); // 7.4
          const depth = LADDER_SCALE * 2; // 1.0

          this.scale.set(
               isZ ? depth : width,
               this.scale.y,
               isZ ? width : depth
          );

          super.update();

          if (!this.group) this.rebuild();

          if (this.group) {
               if (Math.abs(this.group.userData.height - this.scale.y) > 0.1 || this.group.userData.direction !== this.direction) {
                    this.rebuild();
               } else {
                    this.group.position.copy(this.position);
                    // this.group.quaternion.copy(this.quaternion);
                    this.group.rotation.y = this.direction * Math.PI / 2;
                    this.group.scale.set(1, 1, 1);
                    this.group.visible = this.visible;
               }

               this.group.userData.height = this.scale.y;
               this.group.userData.direction = this.direction;
          }
     }

     override destroy(): void {
          this.disposeGroup();
          helperManager.remove(this);
     }

     override toMapObject(): MapObject {
          return {
               ...super.toMapObject('LADDER'),
               d: this.direction,
               // We store scale.y (height) in the s array, but ignore X/Z on read
               s: [1, this.scale.y, 1]
          };
     }

     override fromMapObject(data: MapObject): void {
          super.fromMapObject(data);
          if (data.s) this.scale.y = data.s[1] ?? 1; // Only take height
          if (data.d !== undefined) this.direction = data.d;
          if (data.col !== undefined) this.collision = data.col === 1;
          this.rebuild();
     }

     override toJSON() {
          const json = super.toJSON();

          return Object.assign(json, {
               cubeshot: {
                    direction: this.direction,
                    collision: this.collision
               }
          });
     }

     override fromJSON(json: Awaited<ReturnType<CSLadderObject["toJSON"]>>): void {


          if (json.cubeshot) {
               this.direction = json.cubeshot.direction || 0;
               this.collision = json.cubeshot.collision ?? true;
          }
     }

     override copy(source: Object3D, recursive?: boolean): this {
          super.copy(source, recursive);

          if (source instanceof CSLadderObject) {
               this.direction = source.direction;
               this.collision = source.collision;
          }

          return this;
     }
}


// Instance the spawn point helpers too i guess... later i'm tired
class CSSpawnPointObject extends ICSObject {
     static override type = 'CubeShotSpawnPoint';
     static override icon: [string, string] = ['uil uil-user-location', '#00BCD4'];
     override icon = CSSpawnPointObject.icon;
     override type = CSSpawnPointObject.type;
     private helper?: Mesh;

     public static HEIGHT = 12;
     public static RADIUS = 4;

     constructor() {
          super();
          this.name = 'Spawn Point';
     }

     private createComponents() {
          this.createComponent('Spawn Point', 'uil uil-user-location');
     }

     override init(store?: StoreAdapter) {
          if (!this.initBase(store)) return;

          this.createComponents();
          helperManager.register(this);
          const geo = new CapsuleGeometry(CSSpawnPointObject.RADIUS, CSSpawnPointObject.HEIGHT, 4, 8);
          const mat = makeStandardMaterial(0x00FF00, { transparent: true, opacity: 0.5 });
          this.helper = new Mesh(geo, mat);
          this.store?.scene?.add(this.helper);
          syncTransform(this, this.helper);
     }

     override update() {

          super.update();

          if (this.helper) {
               syncTransform(this, this.helper);
               this.helper.position.y += (CSSpawnPointObject.HEIGHT / 2) + CSSpawnPointObject.RADIUS
          }
     }

     create() { }

     override destroy() {
          this.helper?.removeFromParent();
          helperManager.remove(this);
     }

     override toMapObject(): MapObject {
          return super.toMapObject('SPAWN_POINT')
     }

     override fromJSON(): void {

     }


}

class CSDeathZoneObject extends ICSObject {

     static override type = 'CubeShotDeathZone';
     static override icon: [string, string] = ['uil uil-exclamation-triangle', '#F44336'];
     override icon = CSDeathZoneObject.icon;
     override type = CSDeathZoneObject.type;
     private helper?: Mesh;

     private widthOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private heightOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     private depthOption: ReturnType<this["createComponentOption"]> | undefined = undefined;

     constructor() {
          super();
          this.name = 'Death Zone';
          this.size.set(5, 5, 5);
          this.scale.set(5, 5, 5);
     }

     private createComponents() {
          const comp = this.createComponent('Death Zone', 'uil uil-exclamation-triangle');

          this.widthOption = comp?.createComponentOption('Width', this.scale.x, 'number', { min: 1, max: 100, step: 1 })
               ?.then(c => { this.scale.x = c.value }) as ReturnType<this["createComponentOption"]>;

          this.heightOption = comp?.createComponentOption('Height', this.scale.y, 'number', { min: 1, max: 100, step: 1 })
               ?.then(c => { this.scale.y = c.value }) as ReturnType<this["createComponentOption"]>;

          this.depthOption = comp?.createComponentOption('Depth', this.scale.z, 'number', { min: 1, max: 100, step: 1 })
               ?.then(c => { this.scale.z = c.value }) as ReturnType<this["createComponentOption"]>;
     }

     private updateComponents() {
          this.widthOption?.update(this.scale.x);
          this.heightOption?.update(this.scale.y);
          this.depthOption?.update(this.scale.z);
          this.updateBound();
     }

     private rebuild() {
          if (!isStoreReady(this)) return;
          this.helper?.removeFromParent();
          const geo = new BoxGeometry(this.scale.x, this.scale.y, this.scale.z);
          const mat = makeStandardMaterial(0xFF0000, { transparent: true, opacity: 0.2, wireframe: true });
          this.helper = new Mesh(geo, mat);
          this.store?.scene?.add(this.helper);
          syncTransform(this, this.helper);
          this.updateComponents();
     }

     override create() {
          this.rebuild();
     }

     override init(store?: StoreAdapter) {
          if (!this.initBase(store)) return;

          this.createComponents();
          helperManager.register(this);
          this.rebuild();
     }

     override update() {

          super.update();

          if (!this.parent) return this.destroy();
          else if (!this.helper) this.rebuild();

          if (this.helper) {
               const geo = this.helper.geometry as BoxGeometry;
               if (geo.parameters.width !== this.scale.x || geo.parameters.height !== this.scale.y || geo.parameters.depth !== this.scale.z) {
                    this.rebuild();
               } else {
                    syncTransform(this, this.helper);
               }
          }
     }

     override destroy() {
          this.helper?.removeFromParent();
          helperManager.remove(this);
     }

     override toMapObject(): MapObject { return super.toMapObject('DEATH_ZONE'); }

     override fromMapObject(data: MapObject) { super.fromMapObject(data); this.rebuild(); }

     override fromJSON(): void { }


}

export class MeshInstanceGroup {
     public mesh: InstancedMesh | undefined;

     public objects: Set<CSMeshObject> = new Set();
     public map: Map<CSMeshObject, number> = new Map();

     // NEW: Reverse lookup to enable O(1) removal
     private indexToObj: Map<number, CSMeshObject> = new Map();

     public capacity: number = 20;
     public geometry: BufferGeometry | undefined;
     public material: MeshStandardMaterial | undefined;
     public scene: Scene | undefined;
     public loading: boolean = false;

     constructor(public model: string, scene?: Scene) {
          this.scene = scene;
          this.load();
     }

     async load() {
          if (this.loading) return;
          this.loading = true;

          try {
               const blob = await MODEL_BLOBS[this.model];
               if (!blob) throw new Error(`Failed to load model ${this.model}`);

               const object = await api.import("obj", blob);

               if (!object) throw new Error(`Failed to load model ${this.model}`);

               let mesh: Mesh | undefined;
               object.traverse((c: any) => {
                    if (c.isMesh && !mesh) mesh = c;
               });

               if (mesh) {
                    mesh.geometry.computeVertexNormals();
                    mesh.geometry.computeBoundingBox();

                    if (!mesh.geometry.boundingBox) {
                         console.error(`[Cubeshot] Failed to compute bounding box for model ${this.model}`);
                         return;
                    }

                    // Move the mesh's bottom to the origin
                    mesh.geometry.translate(0, -mesh.geometry.boundingBox.min.y, 0);

                    this.geometry = mesh.geometry;

                    this.material = textureManager.getMaterial(this.model, { vertexColors: false });
                    this.build();
               }

          } catch (e) {
               console.error(`[Cubeshot] Failed to load model ${this.model}`, e);
          } finally {
               this.loading = false;
          }
     }

     build() {
          if (this.mesh) {
               this.mesh.removeFromParent();
               this.mesh.dispose();
          }

          if (!this.geometry || !this.material) return;

          const count = Math.max(this.capacity, this.objects.size);
          this.mesh = new InstancedMesh(this.geometry, this.material, count);
          this.mesh.frustumCulled = false;
          this.mesh.castShadow = true;
          this.mesh.receiveShadow = true;
          this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);

          if (this.scene) this.scene.add(this.mesh);

          this.updateAll();
     }

     updateAll() {
          if (!this.mesh) return;
          this.objects.forEach(obj => this.updateObject(obj));
          this.mesh.count = this.objects.size;
          this.mesh.instanceMatrix.needsUpdate = true;
     }

     add(obj: CSMeshObject) {
          if (this.objects.has(obj)) return;

          // Current size is the index for the new item
          const index = this.objects.size;

          this.objects.add(obj);
          this.map.set(obj, index);
          this.indexToObj.set(index, obj); // Track reverse mapping

          if (this.objects.size > this.capacity) {
               this.expand();
          } else {
               this.updateObject(obj);
               if (this.mesh) {
                    this.mesh.count = this.objects.size;
                    this.mesh.instanceMatrix.needsUpdate = true;
               }
          }
     }

     remove(obj: CSMeshObject) {
          const index = this.map.get(obj);
          if (index === undefined) return;

          // Get the object currently at the end of the list
          const lastIndex = this.objects.size - 1;
          const lastObj = this.indexToObj.get(lastIndex);

          if (!lastObj) {
               // Should not happen if logic is sound
               return;
          }

          // Perform Swap if the removed item is not the last one
          if (index !== lastIndex) {
               // 1. Move the data in the InstancedMesh
               if (this.mesh) {
                    const matrix = new Matrix4();
                    this.mesh.getMatrixAt(lastIndex, matrix);
                    this.mesh.setMatrixAt(index, matrix);
               }

               // 2. Update our mappings to reflect that lastObj moved to 'index'
               this.map.set(lastObj, index);
               this.indexToObj.set(index, lastObj);
          }

          // Remove the object
          this.objects.delete(obj);
          this.map.delete(obj);

          // Remove the reference to the last index (it is either deleted or moved)
          this.indexToObj.delete(lastIndex);

          if (this.mesh) {
               this.mesh.count = this.objects.size;
               this.mesh.instanceMatrix.needsUpdate = true;
          }
     }

     updateObject(obj: CSMeshObject) {
          const index = this.map.get(obj);
          if (index === undefined || !this.mesh) return;

          obj.updateWorldMatrix(true, false);

          // If not visible, scale to near-zero to hide the instance
          if (!obj.visible) {
               const hiddenMatrix = new Matrix4();
               hiddenMatrix.makeScale(0.0001, 0.0001, 0.0001);
               this.mesh.setMatrixAt(index, hiddenMatrix);
          } else {
               this.mesh.setMatrixAt(index, obj.matrixWorld);
          }
          this.mesh.instanceMatrix.needsUpdate = true;
     }

     expand() {
          this.capacity *= 2;
          this.build();
     }
}

class MeshInstanceManager {
     groups: Map<string, MeshInstanceGroup> = new Map();
     scene: Scene | undefined;

     setScene(scene: Scene) {
          this.scene = scene;
     }

     register(obj: CSMeshObject) {
          if (!this.scene && obj.store?.scene) this.scene = obj.store.scene;

          let group = this.groups.get(obj.model);
          if (!group) {
               group = new MeshInstanceGroup(obj.model, this.scene);
               this.groups.set(obj.model, group);
          }

          group.add(obj);
     }

     update(obj: CSMeshObject) {
          let group = this.groups.get(obj.model);

          // If model changed, move to correct group
          if (!group || !group.map.has(obj)) {
               this.remove(obj);
               this.register(obj);
               return;
          }

          group.updateObject(obj);
     }

     remove(obj: CSMeshObject) {
          for (const group of this.groups.values()) {
               if (group.map.has(obj)) {
                    group.remove(obj);
                    return;
               }
          }
     }
}

const meshManager = new MeshInstanceManager();

export class CSMeshObject extends ICSObject {
     static override type: string = 'CubeShotMesh';
     static override icon: [string, string] = ['uil uil-cube', '#607D8B'];

     override icon = CSMeshObject.icon;
     override type = CSMeshObject.type;

     public modelOption: ReturnType<this["createComponentOption"]> | undefined = undefined;
     public collisionOption: ReturnType<this["createComponentOption"]> | undefined = undefined;

     private lastMatrix = new Matrix4();
     private lastVisible: boolean = true;
     private lastModel: string = '';

     constructor(public model: string = 'CRATE') {
          super();
          this.name = model;
          this.scale.setScalar(SCALES[model as keyof typeof SCALES] ?? 1);
     }

     private createComponents() {
          const component = this.createComponent('Prefab', 'uil uil-cube');

          this.modelOption = component?.createComponentOption('Model', MODELS.indexOf(this.model), 'select', { options: MODELS })
               ?.then(c => {
                    this.model = MODELS[c.value] ?? this.model;
                    meshManager.update(this);
               }) as ReturnType<this["createComponentOption"]>;

          this.collisionOption = component?.createComponentOption('Collision', this.collision, 'boolean')
               ?.then(c => { this.collision = !!c.value }) as ReturnType<this["createComponentOption"]>;

     }

     private updateComponents() {
          this.modelOption?.update(MODELS.indexOf(this.model));
          this.collisionOption?.update(this.collision);
     }

     public override updateBound() {
          if (!this.bound) return;

          const group = meshManager.groups.get(this.model);

          if (!group || !group.geometry || !group.geometry.boundingBox) {

               super.updateBound();
               return;
          }


          this.updateWorldMatrix(true, false);

          this.matrixWorld.decompose(_position, _quaternion, _scale);

          group.geometry.boundingBox.getSize(_scale2).multiply(_scale);

          _position.y += _scale2.y / 2;

          setOBBFromCenterQuatSize(this.obb, this.bound, _position, _quaternion, _scale2);
     }

     override init(store?: StoreAdapter): void {
          if (!this.initBase(store)) return;

          if (store?.scene) meshManager.setScene(store.scene);

          this.createComponents();
          meshManager.register(this);
          helperManager.register(this);
     }

     override update(): void {
          if (!this.parent) return this.destroy();

          if (this.model in SCALES) this.scale.setScalar(SCALES[this.model as keyof typeof SCALES] ?? 1);

          this.updateMatrix();
          this.updateMatrixWorld(false);
          this.updateBound();
          helperManager.update(this);

          if (!this.matrix.equals(this.lastMatrix) || this.visible !== this.lastVisible || this.model !== this.lastModel) {
               meshManager.update(this);
               this.lastMatrix.copy(this.matrix);
               this.lastVisible = this.visible;
               this.lastModel = this.model;
          }
     }

     override destroy(): void {
          meshManager.remove(this);
          helperManager.remove(this);
     }

     public override toMapObject(): MapObject {
          return {
               ...super.toMapObject(this.model),
               i: PREFAB_IDS.indexOf(this.model),
          };
     }

     public override fromMapObject(data: MapObject): void {
          super.fromMapObject(data);
          if (MODELS.includes(data.id)) {
               this.model = data.id;
          }
          if (data.col !== undefined) this.collision = data.col === 1;
          this.updateComponents();
          meshManager.update(this);
     }

     override toJSON() {
          const json = super.toJSON();
          return Object.assign(json, {
               cubeshot: {
                    model: this.model,
                    collision: this.collision
               }
          });
     }

     override fromJSON(json: Awaited<ReturnType<CSMeshObject["toJSON"]>>): void {

          if (json.cubeshot) {
               this.model = json.cubeshot.model || 'CRATE';
               this.collision = json.cubeshot.collision ?? true;
          }
     }

     override create(): void {

     }

     override copy(source: Object3D, recursive?: boolean): this {

          super.copy(source, recursive);

          if (source instanceof CSMeshObject) {

               this.model = source.model;
               this.collision = source.collision;
          }


          return this;
     }
}

api.registerCustomObject('Cube', CSCubeObject);
api.registerCustomObject('Plane', CSPlaneObject);
api.registerCustomObject('Ladder', CSLadderObject);
api.registerCustomObject('Spawn Point', CSSpawnPointObject);
api.registerCustomObject('Death Zone', CSDeathZoneObject);
api.registerCustomObject('Prefab', CSMeshObject);


class CSObjectTypeStoreEntry extends CustomStoreObject {

     static override type = 'CubeShotObjectType';

     public instance: typeof CSMeshObject | typeof CSCubeObject | typeof CSPlaneObject | typeof CSLadderObject | typeof CSSpawnPointObject | typeof CSDeathZoneObject;

     public customModelId?: string;
     public customTextureId?: string;

     constructor(
          objectName: string,
          objectIcon: [string, string],
          ObjectClass: any
     ) {
          super();
          this.name = objectName;
          this.icon = objectIcon;
          this.instance = ObjectClass;

          this.options.deletable = false;
          this.options.nameEditable = false;
     }

     override onDoubleClick(event?: MouseEvent): void {
          super.onDoubleClick(event);

          const store = api.getStore();
          const object = new this.instance();
          object.headless = false;

          if (object instanceof CSCubeObject && this.customTextureId) object.texture = this.customTextureId;
          else if (object instanceof CSMeshObject && this.customModelId) object.model = this.customModelId;

          object.init(store);

          api.object("add", object);

     }
}

class CSCustomTextureStoreEntry extends CustomStoreObject {
     static override type = 'CubeShotCustomTexture';
     public textureId: string;
     public textureUrl: string;

     constructor(id: string, name: string, textureUrl: string) {
          super();
          this.textureId = id;
          this.textureUrl = textureUrl;
          this.name = name;
          this.icon = [textureUrl, '#2196F3'];

          // Custom textures CAN be deleted
          this.options.deletable = true;
          this.options.nameEditable = false;
     }

     override onDoubleClick(event?: MouseEvent): void {
          super.onDoubleClick(event);

          const store = api.getStore();
          const object = new CSCubeObject();
          object.headless = false;
          object.texture = this.textureId;
          object.init(store);
          api.object("add", object, true); // toCursor = true
     }

     override dispose(): void {
          // Remove the texture when this store entry is deleted
          this.removeTexture();
     }

     private async removeTexture(): Promise<void> {
          const success = await customAssetStorage.removeTexture(this.textureId);
          if (success) {
               api.showNotification(`Removed custom texture: ${this.name}`, 'success');
               // Trigger refresh of the folder
               this.dispatchEvent({ type: 'update' });
          } else {
               api.showNotification(`Failed to remove texture: ${this.name}`, 'error');
          }
     }
}

// Store entry for custom models - can be deleted
class CSCustomModelStoreEntry extends CustomStoreObject {
     static override type = 'CubeShotCustomModel';
     public modelId: string;

     constructor(id: string, name: string, thumbnailUrl?: string) {
          super();
          this.modelId = id;
          this.name = name;
          this.icon = thumbnailUrl ? [thumbnailUrl, '#607D8B'] : CSMeshObject.icon;

          // Custom models CAN be deleted
          this.options.deletable = true;
          this.options.nameEditable = false;
     }

     override onDoubleClick(event?: MouseEvent): void {
          super.onDoubleClick(event);

          const store = api.getStore();
          const object = new CSMeshObject(this.modelId);
          object.headless = false;
          object.init(store);
          api.object("add", object, true); // toCursor = true
     }

     override dispose(): void {
          // Remove the model when this store entry is deleted
          this.removeModel();
     }

     private async removeModel(): Promise<void> {
          const success = await customAssetStorage.removeModel(this.modelId);
          if (success) {
               api.showNotification(`Removed custom model: ${this.name}`, 'success');
               this.dispatchEvent({ type: 'update' });
          } else {
               api.showNotification(`Failed to remove model: ${this.name}`, 'error');
          }
     }
}

// "Add" button store entry for importing new textures
class CSAddCustomTextureStoreEntry extends CustomStoreObject {
     static override type = 'CubeShotAddTexture';

     constructor() {
          super();
          this.name = 'Add Texture';
          this.icon = ['uil uil-plus-circle', '#4CAF50'];

          this.options.deletable = false;
          this.options.nameEditable = false;
     }

     override onDoubleClick(event?: MouseEvent): void {
          super.onDoubleClick(event);
          this.importTexture();
     }

     private async importTexture(): Promise<void> {
          try {
               // Check if storage is initialized
               if (!await customAssetStorage.isInitialized()) {
                    const initialized = await customAssetStorage.initialize();
                    if (!initialized) {
                         api.showNotification('Please select a folder to store custom assets', 'warning');
                         return;
                    }
               }

               // Request image file
               const file = await api.requestReadFile({
                    extensions: ['.png', '.jpg', '.jpeg', '.webp'],
                    mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
                    multiple: false
               }) as File;

               if (!file) return;

               // Ask for texture ID/name
               const result = await api.showDialog('Add Custom Texture', 'Enter a name for this texture:', [
                    {
                         type: 'text',
                         label: 'Texture Name',
                         placeholder: 'MY_TEXTURE',
                         value: file.name.replace(/\.[^/.]+$/, '').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
                    }
               ]).promise;

               if (!result || !result[0]) return;

               const textureName = (result[0] as any).value?.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
               if (!textureName) {
                    api.showNotification('Invalid texture name', 'error');
                    return;
               }

               // Check for duplicate IDs
               if (TEXTURE_IDS.includes(textureName)) {
                    api.showNotification(`Texture "${textureName}" already exists`, 'error');
                    return;
               }

               // Convert file to blob
               const blob = await file.slice();

               // Save to storage
               const blobUrl = await customAssetStorage.saveTexture(textureName, textureName, blob);
               if (!blobUrl) {
                    api.showNotification('Failed to save texture', 'error');
                    return;
               }

               // Add to arrays
               TEXTURE_IDS.push(textureName);
               customTextureUrls[textureName] = blobUrl;
               customTextures.push({ id: textureName, name: textureName, blobUrl });

               // Create store entry
               const storeEntry = new CSCustomTextureStoreEntry(textureName, textureName, blobUrl);
               api.addCustomStoreObject(storeEntry, CUBESHOT_CUSTOM_TEXTURES_FOLDER_ID);

               // Also add a cube entry with this texture
               const cubeStoreEntry = new CSObjectTypeStoreEntry(
                    capitalize(textureName),
                    [toDataURL(generateCubeSVG({
                         rotX: 35,
                         rotY: 45,
                         gap: 0,
                         cubeSize: 250,
                         texture: blobUrl
                    })), CSCubeObject.icon[1]],
                    CSCubeObject
               );
               cubeStoreEntry.customTextureId = textureName;
               api.addCustomStoreObject(cubeStoreEntry, CUBESHOT_CUBE_FOLDER_ID);

               api.showNotification(`Added custom texture: ${textureName}`, 'success');

          } catch (error) {
               console.error('[Cubeshot] Failed to import texture:', error);
               api.showNotification('Failed to import texture', 'error');
          }
     }
}

// "Add" button store entry for importing new models
class CSAddCustomModelStoreEntry extends CustomStoreObject {
     static override type = 'CubeShotAddModel';

     constructor() {
          super();
          this.name = 'Add Model';
          this.icon = ['uil uil-plus-circle', '#FF9800'];

          this.options.deletable = false;
          this.options.nameEditable = false;
     }

     override onDoubleClick(event?: MouseEvent): void {
          super.onDoubleClick(event);
          this.importModel();
     }

     private async importModel(): Promise<void> {
          try {
               // Check if storage is initialized
               if (!await customAssetStorage.isInitialized()) {
                    const initialized = await customAssetStorage.initialize();
                    if (!initialized) {
                         api.showNotification('Please select a folder to store custom assets', 'warning');
                         return;
                    }
               }

               // Request OBJ file
               const modelFile = await api.requestReadFile({
                    extensions: ['.obj'],
                    multiple: false
               }) as File;

               if (!modelFile) return;

               // Ask for model ID/name
               const nameResult = await api.showDialog('Add Custom Model', 'Enter a name for this model:', [
                    {
                         type: 'text',
                         label: 'Model Name',
                         placeholder: 'MY_MODEL',
                         value: modelFile.name.replace(/\.[^/.]+$/, '').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
                    }
               ]).promise;

               if (!nameResult || !nameResult[0]) return;

               const modelName = (nameResult[0] as any).value?.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
               if (!modelName) {
                    api.showNotification('Invalid model name', 'error');
                    return;
               }

               // Check for duplicate IDs
               if (MODELS.includes(modelName)) {
                    api.showNotification(`Model "${modelName}" already exists`, 'error');
                    return;
               }

               // Ask if they want to upload a texture
               const textureResult = await api.showDialog('Model Texture', 'Do you want to upload a texture for this model?', [
                    {
                         type: 'checkbox',
                         label: 'Upload texture',
                         value: true
                    }
               ]).promise;

               let textureBlob: Blob | undefined;

               if (textureResult && (textureResult[0] as any).value) {
                    const textureFile = await api.requestReadFile({
                         extensions: ['.png', '.jpg', '.jpeg', '.webp'],
                         mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
                         multiple: false
                    }) as File;

                    if (textureFile) {
                         textureBlob = await textureFile.slice();
                    }
               }

               // Convert model file to blob
               const modelBlob = await modelFile.slice();

               // Save to storage
               const urls = await customAssetStorage.saveModel(modelName, modelName, modelBlob, textureBlob);
               if (!urls) {
                    api.showNotification('Failed to save model', 'error');
                    return;
               }

               // Add to arrays
               MODELS.push(modelName);
               PREFAB_IDS.push(modelName);
               MODEL_BLOBS[modelName] = Promise.resolve(modelBlob);

               if (urls.textureUrl) {
                    customTextureUrls[modelName] = urls.textureUrl;
               }

               customModels.push({
                    id: modelName,
                    name: modelName,
                    blobUrl: urls.modelUrl,
                    textureBlobUrl: urls.textureUrl
               });

               // Generate thumbnail for the model
               let thumbnailUrl: string | undefined;
               try {
                    const object = await api.import("obj", modelBlob);
                    if (object) {
                         // Apply texture if we have one
                         if (urls.textureUrl) {
                              object.traverse((child: any) => {
                                   if (child.isMesh) {
                                        const texture = loadTexture(urls.textureUrl!);
                                        child.material = new MeshStandardMaterial({
                                             map: texture,
                                             roughness: 1,
                                             metalness: 0
                                        });
                                   }
                              });
                         }

                         thumbnailUrl = await api.generateThumbnailDataURL(object, DEFAULT_THUMBNAIL_OPTIONS);
                    }
               } catch (e) {
                    console.warn('[Cubeshot] Failed to generate thumbnail for custom model:', e);
               }

               // Create store entry
               const storeEntry = new CSCustomModelStoreEntry(modelName, modelName, thumbnailUrl);
               api.addCustomStoreObject(storeEntry, CUBESHOT_CUSTOM_MODELS_FOLDER_ID);

               // Also add a prefab store entry
               const prefabStoreEntry = new CSObjectTypeStoreEntry(
                    capitalize(modelName),
                    thumbnailUrl ? [thumbnailUrl, CSMeshObject.icon[1]] : CSMeshObject.icon,
                    CSMeshObject
               );
               prefabStoreEntry.customModelId = modelName;
               api.addCustomStoreObject(prefabStoreEntry, CUBESHOT_PREFAB_FOLDER_ID);

               api.showNotification(`Added custom model: ${modelName}`, 'success');

          } catch (error) {
               console.error('[Cubeshot] Failed to import model:', error);
               api.showNotification('Failed to import model', 'error');
          }
     }
}

// Folder IDs for custom assets
const CUBESHOT_CUSTOM_TEXTURES_FOLDER_ID = 'cubeshot-custom-textures';
const CUBESHOT_CUSTOM_MODELS_FOLDER_ID = 'cubeshot-custom-models';


export async function generateCubeSVG(state: { rotX: number, rotY: number, cubeSize: number, gap: number, texture: string }): string {

     // Convert blob URL to base64 data URL if needed
     let textureDataUrl = state.texture;
     if (state.texture.startsWith('blob:')) {
          try {
               const response = await fetch(state.texture);
               const blob = await response.blob();
               const base64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(blob);
               });
               textureDataUrl = base64;
          } catch (error) {
               console.warn('[Cubeshot] Failed to convert blob to data URL:', error);
               // Fallback to a placeholder or default texture
               textureDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
          }
     }

     const scriptString = `
             <![CDATA[
             (function() {
                 const s = ${state.cubeSize};
                 let rotX = ${state.rotX};
                 let rotY = ${state.rotY};
                 const gap = ${state.gap};
                 const container = document.getElementById('cube-container');
                 
                 const faces = [
                     { id: 'front', o: {x:-0.5, y:-0.5, z:0.5}, u: {x:1, y:0, z:0}, v: {x:0, y:1, z:0}, n: {x:0, y:0, z:1} },
                     { id: 'back', o: {x:0.5, y:-0.5, z:-0.5}, u: {x:-1, y:0, z:0}, v: {x:0, y:1, z:0}, n: {x:0, y:0, z:-1} },
                     { id: 'right', o: {x:0.5, y:-0.5, z:0.5}, u: {x:0, y:0, z:-1}, v: {x:0, y:1, z:0}, n: {x:1, y:0, z:0} },
                     { id: 'left', o: {x:-0.5, y:-0.5, z:-0.5}, u: {x:0, y:0, z:1}, v: {x:0, y:1, z:0}, n: {x:-1, y:0, z:0} },
                     { id: 'top', o: {x:-0.5, y:-0.5, z:-0.5}, u: {x:1, y:0, z:0}, v: {x:0, y:0, z:1}, n: {x:0, y:-1, z:0} },
                     { id: 'bottom', o: {x:-0.5, y:0.5, z:0.5}, u: {x:1, y:0, z:0}, v: {x:0, y:0, z:-1}, n: {x:0, y:1, z:0} }
                 ];
 
                 function rotatePoint(x, y, z, rx, ry) {
                     let y1 = y * Math.cos(rx) - z * Math.sin(rx);
                     let z1 = y * Math.sin(rx) + z * Math.cos(rx);
                     let x1 = x;
                     let x2 = x1 * Math.cos(ry) + z1 * Math.sin(ry);
                     let z2 = -x1 * Math.sin(ry) + z1 * Math.cos(ry);
                     let y2 = y1;
                     return { x: x2, y: y2, z: z2 };
                 }
 
                 function loop() {
                     rotY = (rotY + 0.5) % 360;
                     render();
                     requestAnimationFrame(loop);
                 }
 
                 function render() {
                     const rx = rotX * Math.PI / 180;
                     const ry = rotY * Math.PI / 180;
                     let html = '';
                     
                     faces.forEach(function(face) {
                         const nRot = rotatePoint(face.n.x, face.n.y, face.n.z, rx, ry);
                         if (nRot.z > 0.001) {
                             const gapOffset = { x: nRot.x * gap, y: nRot.y * gap };
                             const oRot = rotatePoint(face.o.x * s, face.o.y * s, face.o.z * s, rx, ry);
                             const uRot = rotatePoint(face.u.x, face.u.y, face.u.z, rx, ry);
                             const vRot = rotatePoint(face.v.x, face.v.y, face.v.z, rx, ry);
                             
                             const mat = 'matrix(' + 
                                 uRot.x.toFixed(4) + ',' + uRot.y.toFixed(4) + ',' + 
                                 vRot.x.toFixed(4) + ',' + vRot.y.toFixed(4) + ',' + 
                                 (oRot.x + gapOffset.x + 200).toFixed(2) + ',' + (oRot.y + gapOffset.y + 200).toFixed(2) + ')';
                             
                             const light = nRot.y * -0.5 + nRot.x * 0.2 + 0.8; 
                             const shade = Math.max(0, Math.min(0.6, 1 - light));
                             
                             html += '<g><rect x="0" y="0" width="' + s + '" height="' + s + '" fill="url(#cubeTexture)" transform="' + mat + '" /><rect x="0" y="0" width="' + s + '" height="' + s + '" fill="black" opacity="' + shade.toFixed(2) + '" transform="' + mat + '" style="pointer-events:none;" /></g>';
                         }
                     });
                     container.innerHTML = html;
                 }
                 
                 // Start animation on load
                 window.onload = loop;
             })();
             ]]>
     `;

     // Construct the final SVG with the script embedded.
     // We escape the closing script tag to prevent parsing issues when embedded in HTML.
     return `
 <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
     <defs>
         <pattern id="cubeTexture" patternUnits="userSpaceOnUse" width="${state.cubeSize}" height="${state.cubeSize}">
             <image href="${textureDataUrl}" x="0" y="0" width="${state.cubeSize}" height="${state.cubeSize}" preserveAspectRatio="none" crossorigin="anonymous" />
         </pattern>
     </defs>
     <g id="cube-container"></g>
     <script type="text/javascript">
         ${scriptString}
     <\/script>
 </svg>`;
}

export const toDataURL = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

const CUBESHOT_MISC_FOLDER_ID = 'cubeshot-miscs';
const CUBESHOT_CUBE_FOLDER_ID = 'cubeshot-cubes';
const CUBESHOT_PLANE_FOLDER_ID = 'cubeshot-planes';
const CUBESHOT_PREFAB_FOLDER_ID = 'cubeshot-prefabs';

const CUBESHOT_MISC_OBJECTS = {
     DEATH_ZONE: CSDeathZoneObject,
     SPAWN_POINT: CSSpawnPointObject,
     LADDER: CSLadderObject,
}

const MISSING_TEXTURES = ["DIRT", "GRID", "GREY", "DEFAULT", "FLAG", "GRASS", "CHECK", "LINK"]

const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()

// Initialize Blocks folder
createStoreFolder('Blocks', CUBESHOT_CUBE_FOLDER_ID, 100);
if (api.hasFolder(CUBESHOT_CUBE_FOLDER_ID)) {
     for (const cubeTexture of TEXTURE_IDS) {
          if (MISSING_TEXTURES.includes(cubeTexture)) continue;

          const storeEntry = new CSObjectTypeStoreEntry(
               capitalize(cubeTexture),
               [toDataURL(generateCubeSVG({
                    rotX: 35,
                    rotY: 45,
                    gap: 0,
                    cubeSize: 250,
                    texture: getTextureUrl(cubeTexture)
               })), CSCubeObject.icon[1]],
               CSCubeObject
          );
          storeEntry.customTextureId = cubeTexture;
          api.addCustomStoreObject(storeEntry, CUBESHOT_CUBE_FOLDER_ID);
     }
}

// Initialize Prefabs folder
createStoreFolder('Prefabs', CUBESHOT_PREFAB_FOLDER_ID, 100);
if (api.hasFolder(CUBESHOT_PREFAB_FOLDER_ID)) {
     for (const prefab of MODELS) {
          const storeEntry = new CSObjectTypeStoreEntry(
               capitalize(prefab),
               CSMeshObject.icon,
               CSMeshObject
          );
          storeEntry.customModelId = prefab;
          api.addCustomStoreObject(storeEntry, CUBESHOT_PREFAB_FOLDER_ID);

          // Generate thumbnail asynchronously
          (async () => {
               try {
                    const blob = await MODEL_BLOBS[prefab];
                    if (!blob) {
                         console.warn(`[Cubeshot] Failed to load model for thumbnail: ${prefab}`);
                         return;
                    }

                    const object = await api.import("obj", blob);
                    if (!object) {
                         console.warn(`[Cubeshot] Failed to load model for thumbnail: ${prefab}`);
                         return;
                    }

                    let mesh: Mesh | undefined;
                    object.traverse((child: any) => {
                         if (child.isMesh) mesh = child;
                    });

                    const material = await new Promise<MeshStandardMaterial>(resolve => {
                         const mat = textureManager.getMaterial(prefab, { vertexColors: false }, () => resolve(mat))
                    });

                    if (mesh) mesh.material = material;

                    const thumbnailDataURL = await api.generateThumbnailDataURL(object, DEFAULT_THUMBNAIL_OPTIONS);
                    storeEntry.icon = [thumbnailDataURL, CSMeshObject.icon[1]];
                    api.logInfo(`Generated thumbnail for ${prefab}`);
               } catch (error) {
                    console.error(`[Cubeshot] Error generating thumbnail for ${prefab}:`, error);
               }
          })();
     }
}

// Initialize Planes folder
createStoreFolder('Planes', CUBESHOT_PLANE_FOLDER_ID, 100, false);
if (api.hasFolder(CUBESHOT_PLANE_FOLDER_ID)) {
     for (const planeTexture of TEXTURE_IDS) {
          if (MISSING_TEXTURES.includes(planeTexture)) continue;

          const storeEntry = new CSObjectTypeStoreEntry(
               capitalize(planeTexture),
               [getTextureUrl(planeTexture), CSPlaneObject.icon[1]],
               CSPlaneObject
          );
          storeEntry.customTextureId = planeTexture;
          api.addCustomStoreObject(storeEntry, CUBESHOT_PLANE_FOLDER_ID);
     }
}

// Initialize Misc folder
createStoreFolder('Misc', CUBESHOT_MISC_FOLDER_ID, 100);
if (api.hasFolder(CUBESHOT_MISC_FOLDER_ID)) {
     for (const misc of Object.keys(CUBESHOT_MISC_OBJECTS)) {
          if (MODELS.includes(misc)) continue;

          const storeEntry = new CSObjectTypeStoreEntry(
               capitalize(misc),
               CUBESHOT_MISC_OBJECTS[misc as keyof typeof CUBESHOT_MISC_OBJECTS].icon,
               CUBESHOT_MISC_OBJECTS[misc as keyof typeof CUBESHOT_MISC_OBJECTS]
          );
          storeEntry.customModelId = misc;
          api.addCustomStoreObject(storeEntry, CUBESHOT_MISC_FOLDER_ID);
     }
}

// Initialize Custom Textures folder
createStoreFolder('Custom Textures', CUBESHOT_CUSTOM_TEXTURES_FOLDER_ID, 90);
if (api.hasFolder(CUBESHOT_CUSTOM_TEXTURES_FOLDER_ID)) {
     const addTextureEntry = new CSAddCustomTextureStoreEntry();
     api.addCustomStoreObject(addTextureEntry, CUBESHOT_CUSTOM_TEXTURES_FOLDER_ID);
}

// Initialize Custom Models folder
createStoreFolder('Custom Models', CUBESHOT_CUSTOM_MODELS_FOLDER_ID, 89);
if (api.hasFolder(CUBESHOT_CUSTOM_MODELS_FOLDER_ID)) {
     const addModelEntry = new CSAddCustomModelStoreEntry();
     api.addCustomStoreObject(addModelEntry, CUBESHOT_CUSTOM_MODELS_FOLDER_ID);
}

// Load previously saved custom assets
const initAssets = async () => {

     const initialized = await customAssetStorage.initialize();

     if (!initialized) return;

     await customAssetStorage.loadAllAssets();

     // Create store entries for loaded custom textures
     for (const texture of customTextures) {

          const storeEntry = new CSCustomTextureStoreEntry(texture.id, texture.name, texture.blobUrl);

          api.addCustomStoreObject(storeEntry, CUBESHOT_CUSTOM_TEXTURES_FOLDER_ID);

          // Also add a cube entry with this texture
          const cubeStoreEntry = new CSObjectTypeStoreEntry(
               capitalize(texture.name),
               [toDataURL(generateCubeSVG({
                    rotX: 35,
                    rotY: 45,
                    gap: 0,
                    cubeSize: 250,
                    texture: texture.blobUrl
               })), CSCubeObject.icon[1]],
               CSCubeObject
          );

          cubeStoreEntry.customTextureId = texture.id;

          api.addCustomStoreObject(cubeStoreEntry, CUBESHOT_CUBE_FOLDER_ID);
     }

     // Create store entries for loaded custom models
     for (const model of customModels) {
          // Generate thumbnail for the model
          let thumbnailUrl: string | undefined;
          try {
               const blobPromise = MODEL_BLOBS[model.id];
               if (blobPromise) {
                    const resolvedBlob = await blobPromise;
                    if (!resolvedBlob) continue;
                    const object = await api.import("obj", resolvedBlob);
                    if (object) {
                         // Apply texture if we have one
                         if (model.textureBlobUrl) {
                              object.traverse((child: any) => {
                                   if (child.isMesh) {
                                        const texture = loadTexture(model.textureBlobUrl!);
                                        child.material = new MeshStandardMaterial({
                                             map: texture,
                                             roughness: 1,
                                             metalness: 0
                                        });
                                   }
                              });
                         }

                         thumbnailUrl = await api.generateThumbnailDataURL(object, DEFAULT_THUMBNAIL_OPTIONS);
                    }
               }
          } catch (e) {
               console.warn('[Cubeshot] Failed to generate thumbnail for custom model:', e);
          }

          const storeEntry = new CSCustomModelStoreEntry(model.id, model.name, thumbnailUrl);
          api.addCustomStoreObject(storeEntry, CUBESHOT_CUSTOM_MODELS_FOLDER_ID);

          // Also add a prefab store entry
          const prefabStoreEntry = new CSObjectTypeStoreEntry(
               capitalize(model.name),
               thumbnailUrl ? [thumbnailUrl, CSMeshObject.icon[1]] : CSMeshObject.icon,
               CSMeshObject
          );
          prefabStoreEntry.customModelId = model.id;
          api.addCustomStoreObject(prefabStoreEntry, CUBESHOT_PREFAB_FOLDER_ID);
     }

     if (customTextures.length > 0 || customModels.length > 0) {
          api.logInfo(`[Cubeshot] Loaded ${customTextures.length} custom textures and ${customModels.length} custom models`);
     }


};

type CSObject = CSCubeObject | CSPlaneObject | CSLadderObject | CSSpawnPointObject | CSDeathZoneObject | CSMeshObject

const repo: Set<ICSObject> = new Set();

function createObjectFromMapData(data: MapObject, store: StoreAdapter): CSObject {

     let object: CSObject;

     switch (data.id) {
          case 'CUBE': object = new CSCubeObject(); break;
          case 'PLANE': object = new CSPlaneObject(); break;
          case 'LADDER': object = new CSLadderObject(); break;
          case 'SPAWN_POINT': object = new CSSpawnPointObject(); break;
          case 'DEATH_ZONE': object = new CSDeathZoneObject(); break;
          default: {
               if (MODELS.includes(data.id)) object = new CSMeshObject(data.id);
               else object = new CSCubeObject(); // Fallback
               break;
          }
     }

     object.headless = false;

     object.store = store;

     object.init(store);

     object.fromMapObject(data);

     api.object("add", object);

     // @ts-ignore womp womp
     requestAnimationFrame(() => object.updateBound());

     repo.add(object)

     return object;
}

async function importMap(json?: CubeshotMapData) {

     if (!json) {
          const file = await api.requestReadFile({ extensions: ['.json'] }) as File;

          if (!file) return;

          const text = await file.text();

          json = JSON.parse(text) as CubeshotMapData
     }

     const store = api.getStore();

     for (const data of json.objects) {

          if ("t" in data) data.t = TEXTURE_IDS[data.t as unknown as number] ?? data.t;
          if ("i" in data) data.id = PREFAB_IDS[data.i] ?? data.id;

          createObjectFromMapData(data, store);

     }


     for (const spawn of json.spawns || []) {

          const object = new CSSpawnPointObject();

          object.headless = false;

          object.position.fromArray(spawn);

          object.init(store);

          api.object("add", object);

          repo.add(object)


     }
}

async function exportMap() {
     const store = api.getStore();
     const objects: MapObject[] = [];
     const spawns: number[][] = [];

     for (const object of store.customObjects) {

          if (object instanceof CSSpawnPointObject) {

               spawns.push(object.position.toArray());

          } else if (
               object instanceof CSCubeObject ||
               object instanceof CSPlaneObject ||
               object instanceof CSLadderObject ||
               object instanceof CSDeathZoneObject ||
               object instanceof CSMeshObject
          ) {
               objects.push(object.toMapObject());
          }
     }

     const environmentData = getEnvironmentMapData(store);

     const data: CubeshotMapData = {
          name: store.name || 'Map',
          objects,
          spawns,
          camPos: store.camera?.position.toArray() ?? [0, 50, 0],
          modes: [0, 1],
          ...environmentData,
     };

     await api.requestSaveFile(JSON.stringify(data), { suggestedName: 'map.json' });
}

/**
 * Scale the entire map by a given factor.
 * This handles:
 * 1. Object positions (accounting for bottom-origin geometry)
 * 2. Object scales
 * 3. WORLD_UV for texture scaling
 * 4. Rebuilding materials to apply new UV scaling
 * 5. Rebuilding CSPlaneObject and CSMeshObject
 */
function scaleMap(scaleFactor: number) {
     if (scaleFactor <= 0 || scaleFactor === currentMapScale) return;

     const store = api.getStore();
     if (!store.customObjects) return;

     // Calculate the relative scale change from current to new
     const relativeScale = scaleFactor / currentMapScale;

     // Update the global map scale
     currentMapScale = scaleFactor;

     console.log(`${LOG_PREFIX} Scaling map by factor ${relativeScale} (new absolute scale: ${scaleFactor})`);

     // Track objects that need rebuilding
     const planesToRebuild: CSPlaneObject[] = [];

     // Scale all objects
     for (const object of store.customObjects) {
          if (!(object instanceof ICSObject)) continue;

          // Scale position (accounting for bottom-origin geometry)
          // For cubes with bottom-origin: new_y = old_y * scale + (new_height - old_height) / 2
          // But since we're scaling both position and size, the bottom stays at:
          // new_bottom_y = old_bottom_y * scale
          // where old_bottom_y = old_y (since geometry is at bottom)
          // So new_y = old_y * scale (no adjustment needed for bottom-origin)

          const oldPosition = object.position.clone();
          const oldScale = object.scale.clone();

          // Scale the position
          object.position.x *= relativeScale;
          object.position.y *= relativeScale;
          object.position.z *= relativeScale;

          // Scale the object's scale
          object.scale.x *= relativeScale;
          object.scale.y *= relativeScale;
          object.scale.z *= relativeScale;

          // Update matrix and bound
          object.updateMatrix();
          object.updateWorldMatrix(true, false);
          object.updateBound();

          // Update in geometry manager
          if (object instanceof CSCubeObject) {
               geometryManager.update(object);
               helperManager.update(object);
          } else if (object instanceof CSPlaneObject) {
               planesToRebuild.push(object);
               helperManager.update(object);
          } else if (object instanceof CSMeshObject) {
               meshManager.update(object);
               helperManager.update(object);
          } else if (object instanceof CSLadderObject ||
               object instanceof CSSpawnPointObject ||
               object instanceof CSDeathZoneObject) {
               helperManager.update(object);
          }
     }

     // Rebuild all CubeTextureGroup materials with new WORLD_UV
     geometryManager.rebuildAllMaterials();

     // Rebuild CSPlaneObjects (they calculate UVs based on WORLD_UV in their rebuild())
     for (const plane of planesToRebuild) {
          // Force rebuild by triggering the rebuild method through update detection
          plane['lastScaleX'] = -1; // Force rebuild by invalidating cached values
          plane.update();
     }

     api.showNotification(`Map scaled to ${(scaleFactor * 100).toFixed(0)}%`, 'success');
}

/**
 * Generate map data for the current scene (shared by export and sandbox preview)
 * Returns data compatible with IframeBridge's CustomMapData interface
 */
interface GeneratedMapData extends CubeshotMapData {
     shadScale?: number;
}

function getEnvironmentMapData(store: StoreAdapter): Pick<CubeshotMapData, "sky" | "fog" | "fogD" | "light" | "ambient" | "csm"> {
     const environment = store.environment;
     if (!environment) return {};

     const { parameters } = environment;
     const sky = parameters.scene.backgroundColor.getHex();
     const lightColor = parameters.csm.lightColor.getHex();

     const fogEnabled = parameters.fog.enabled;
     const fog = fogEnabled ? parameters.fog.color.getHex() : undefined;
     const fogD = fogEnabled
          ? (parameters.fog.type === "FogExp2" ? parameters.fog.density : parameters.fog.far)
          : undefined;

     return {
          sky,
          fog,
          fogD,
          light: lightColor,
          ambient: sky,
          csm: {
               cascades: parameters.csm.cascades,
               maxFar: parameters.csm.maxFar,
               mode: String(parameters.csm.mode),
               shadowMapSize: parameters.csm.shadowMapSize,
               shadowBias: parameters.csm.shadowBias,
               shadowNormalBias: parameters.csm.shadowNormalBias,
               fade: parameters.csm.fade,
               lightDirection: parameters.csm.lightDirection.toArray() as [number, number, number],
               lightIntensity: parameters.csm.lightIntensity,
               lightColor,
               lightNear: parameters.csm.lightNear,
               lightFar: parameters.csm.lightFar,
               lightMargin: parameters.csm.lightMargin,
          }
     };
}

function generateMapData(): GeneratedMapData {
     const store = api.getStore();
     const objects: MapObject[] = [];
     const spawns: number[][] = [];

     for (const object of store.customObjects) {
          if (object instanceof CSSpawnPointObject) {
               spawns.push(object.position.toArray());
          } else if (
               object instanceof CSCubeObject ||
               object instanceof CSPlaneObject ||
               object instanceof CSLadderObject ||
               object instanceof CSDeathZoneObject ||
               object instanceof CSMeshObject
          ) {
               objects.push(object.toMapObject());
          }
     }

     const environmentData = getEnvironmentMapData(store);

     return {
          name: store.name || 'Map',
          objects,
          spawns,
          camPos: store.camera?.position.toArray() ?? [0, 50, 0],
          modes: [0, 1],
          ...environmentData,
          shadScale: 1,
     };
}

/**
 * Open the Cubeshot sandbox iframe and send the current map data for live preview
 * 
 * Communication follows the IframeBridge protocol:
 * - Parent sends: loadMap, setLoadout, setPlayerConfig, startGame, stopGame, ping, etc.
 * - Game responds: ready, mapLoaded, stateUpdate, gameEvent, error, pong, etc.
 */
const CUBESHOT_SANDBOX_URL = 'https://test.cubeshot.io';
const CUBESHOT_SANDBOX_ORIGIN = 'https://test.cubeshot.io';

// const CUBESHOT_SANDBOX_URL = "http://localhost:5173"
// const CUBESHOT_SANDBOX_ORIGIN = "http://localhost:5173"

let sandboxHandle: ReturnType<typeof api.createIframeWindow> | null = null;
let sandboxReady = false;
let sandboxCapabilities: string[] = [];

/**
 * Collect custom assets used in the map and convert them to ArrayBuffers
 * for transfer to the sandbox iframe.
 */
async function collectCustomAssetsForMap(mapData: CubeshotMapData): Promise<{
     textures: Record<string, ArrayBuffer>;
     models: Record<string, { obj: ArrayBuffer; texture?: ArrayBuffer }>;
}> {
     const usedTextures = new Set<string>();
     const usedModels = new Set<string>();

     // Scan map objects for custom textures and models
     for (const obj of mapData.objects) {

          if (obj.t && customTextureUrls[obj.t]) usedTextures.add(obj.t);


          if (customModels.some(m => m.id === obj.id)) usedModels.add(obj.id);

     }

     const textureBuffers: Record<string, ArrayBuffer> = {};
     const modelBuffers: Record<string, { obj: ArrayBuffer; texture?: ArrayBuffer }> = {};

     // Convert texture blob URLs to ArrayBuffers
     for (const textureId of usedTextures) {
          const blobUrl = customTextureUrls[textureId];
          if (blobUrl) {
               try {
                    const response = await fetch(blobUrl);
                    const buffer = await response.arrayBuffer();
                    textureBuffers[textureId] = buffer;
               } catch (error) {
                    api.log(`${LOG_PREFIX} Failed to fetch texture ${textureId}: ${error}`);
               }
          }
     }

     // Convert model blobs to ArrayBuffers
     for (const modelId of usedModels) {
          const blobPromise = MODEL_BLOBS[modelId];
          if (blobPromise) {
               try {
                    const blob = await blobPromise;
                    if (blob) {
                         const objBuffer = await blob.arrayBuffer();
                         const modelData: { obj: ArrayBuffer; texture?: ArrayBuffer } = { obj: objBuffer };

                         // Check if model has an associated texture
                         const modelInfo = customModels.find(m => m.id === modelId);
                         if (modelInfo?.textureBlobUrl) {
                              const texResponse = await fetch(modelInfo.textureBlobUrl);
                              modelData.texture = await texResponse.arrayBuffer();
                         }

                         modelBuffers[modelId] = modelData;
                    }
               } catch (error) {
                    api.log(`${LOG_PREFIX} Failed to fetch model ${modelId}: ${error}`);
               }
          }
     }

     return { textures: textureBuffers, models: modelBuffers };
}

/**
 * Send map data to the sandbox using the IframeBridge loadMap message format
 */
async function sendMapToSandbox() {
     if (!sandboxHandle?.isOpen()) return;

     const mapData = generateMapData();

     // Collect custom assets used in the map
     const customAssets = await collectCustomAssetsForMap(mapData);
     const hasCustomAssets = Object.keys(customAssets.textures).length > 0 ||
          Object.keys(customAssets.models).length > 0;

     if (hasCustomAssets) {
          api.log(`${LOG_PREFIX} Including ${Object.keys(customAssets.textures).length} custom textures and ${Object.keys(customAssets.models).length} custom models`);
     }

     // Convert to IframeBridge CustomMapData format
     // The IframeBridge expects: { type: 'loadMap', payload: CustomMapData }
     const payload: Record<string, unknown> = {
          name: mapData.name,
          objects: mapData.objects,
          spawns: mapData.spawns,
          camPos: mapData.camPos,
          sky: mapData.sky,
          fog: mapData.fog,
          fogD: mapData.fogD,
          light: mapData.light,
          ambient: mapData.ambient,
          shadScale: mapData.shadScale,
          modes: mapData.modes,
          csm: mapData.csm,
     };

     // Include custom assets if any are used
     if (hasCustomAssets) {
          payload.customAssets = customAssets;
     }

     sandboxHandle.sendMessage({
          type: 'loadMap',
          payload
     }, CUBESHOT_SANDBOX_ORIGIN);
     api.log(`${LOG_PREFIX} Map data sent to sandbox (${mapData.objects.length} objects, ${mapData.spawns?.length || 0} spawns)`);
}

/**
 * Set player configuration in the sandbox
 */
function setPlayerConfig(username?: string, classIndex?: number) {
     if (!sandboxHandle?.isOpen() || !sandboxReady) return;

     sandboxHandle.sendMessage({
          type: 'setPlayerConfig',
          payload: {
               username: username || 'Editor',
               classIndex: classIndex ?? 0
          }
     }, CUBESHOT_SANDBOX_ORIGIN);
     api.log(`${LOG_PREFIX} Player config sent to sandbox`);
}

/**
 * Set player loadout in the sandbox
 */
function setPlayerLoadout(classIndex: number) {
     if (!sandboxHandle?.isOpen() || !sandboxReady) return;

     sandboxHandle.sendMessage({
          type: 'setLoadout',
          payload: { classIndex }
     }, CUBESHOT_SANDBOX_ORIGIN);
     api.log(`${LOG_PREFIX} Loadout set to class ${classIndex}`);
}

function openSandboxPreview() {
     // Close existing sandbox if open
     if (sandboxHandle?.isOpen()) {
          sandboxHandle.close();
     }

     sandboxReady = false;
     sandboxCapabilities = [];

     sandboxHandle = api.createIframeWindow({
          id: 'cubeshot-sandbox',
          title: 'Cubeshot Sandbox',
          icon: 'uil uil-play',
          src: CUBESHOT_SANDBOX_URL,
          sandbox: 'allow-scripts allow-same-origin allow-forms allow-pointer-lock',
          onLoad: () => {
               api.log(`${LOG_PREFIX} Sandbox iframe loaded, waiting for ready message...`);
          },
          onMessage: (data) => {
               // Handle messages from the IframeBridge
               const message = data as { type: string; payload?: any; messageId?: string };

               if (!message || typeof message.type !== 'string') return;

               switch (message.type) {
                    case 'ready':
                         // Game is ready to receive messages
                         sandboxReady = true;
                         sandboxCapabilities = message.payload?.capabilities || [];
                         api.log(`${LOG_PREFIX} Sandbox ready with capabilities: ${sandboxCapabilities.join(', ')}`);

                         // Set default player config
                         setPlayerConfig('MapEditor', 0);

                         // Send map data
                         sendMapToSandbox();
                         break;

                    case 'mapLoaded':
                         if (message.payload?.success) {
                              api.log(`${LOG_PREFIX} Map loaded successfully in sandbox`);
                              // Optionally auto-start the game
                              // startSandboxGame();
                         } else {
                              api.log(`${LOG_PREFIX} Map loading failed`, 'error');
                         }
                         break;

                    case 'stateUpdate':
                         // Game state updates (player position, health, etc.)
                         // Can be used to sync camera or display player info
                         // Logged sparingly to avoid spam
                         break;

                    case 'playerUpdate':
                         // Player state changes
                         break;

                    case 'gameEvent':
                         // Game events (spawn, kill, damage, etc.)
                         const event = message.payload as { type: string; data: any };
                         if (event) {
                              api.log(`${LOG_PREFIX} Game event: ${event.type}`);
                         }
                         break;

                    case 'error':
                         const error = message.payload as { message?: string; error?: string };
                         api.log(`${LOG_PREFIX} Sandbox error: ${error?.message || error?.error || 'Unknown error'}`, 'error');
                         break;

                    case 'pong':
                         const timestamp = message.payload?.timestamp;
                         const latency = timestamp ? Date.now() - timestamp : 'unknown';
                         api.log(`${LOG_PREFIX} Pong received (latency: ${latency}ms)`);
                         break;

                    default:
                         api.log(`${LOG_PREFIX} Unknown message type: ${message.type}`);
               }
          },
          onClose: () => {
               api.log(`${LOG_PREFIX} Sandbox preview closed`);
               sandboxHandle = null;
               sandboxReady = false;
               sandboxCapabilities = [];
          }
     });
}

/**
 * Refresh the sandbox preview with current map data
 */
function refreshSandboxPreview() {
     if (!sandboxHandle?.isOpen()) {
          openSandboxPreview();
          return;
     }

     if (!sandboxReady) {
          api.log(`${LOG_PREFIX} Sandbox not ready yet, waiting...`, 'warn');
          return;
     }

     sendMapToSandbox();
     api.log(`${LOG_PREFIX} Sandbox preview refreshed`);
}

/**
 * Close the sandbox preview
 */
function closeSandboxPreview() {
     if (sandboxHandle?.isOpen()) {
          sandboxHandle.close();
          sandboxHandle = null;
          sandboxReady = false;
          sandboxCapabilities = [];
     }
}

/**
 * Start the game in the sandbox (triggers pointer lock)
 */
function startSandboxGame() {
     if (!sandboxHandle?.isOpen()) {
          api.log(`${LOG_PREFIX} Sandbox is not open`, 'warn');
          return;
     }
     if (!sandboxReady) {
          api.log(`${LOG_PREFIX} Sandbox not ready yet`, 'warn');
          return;
     }
     sandboxHandle.sendMessage({ type: 'startGame' }, CUBESHOT_SANDBOX_ORIGIN);
     api.log(`${LOG_PREFIX} Start game command sent to sandbox`);
}

/**
 * Stop the game in the sandbox
 */
function stopSandboxGame() {
     if (!sandboxHandle?.isOpen()) {
          api.log(`${LOG_PREFIX} Sandbox is not open`, 'warn');
          return;
     }
     if (!sandboxReady) {
          api.log(`${LOG_PREFIX} Sandbox not ready yet`, 'warn');
          return;
     }
     sandboxHandle.sendMessage({ type: 'stopGame' }, CUBESHOT_SANDBOX_ORIGIN);
     api.log(`${LOG_PREFIX} Stop game command sent to sandbox`);
}

/**
 * Ping the sandbox to check connection
 */
function pingSandbox() {
     if (!sandboxHandle?.isOpen()) {
          api.log(`${LOG_PREFIX} Sandbox is not open`, 'warn');
          return;
     }
     sandboxHandle.sendMessage({ type: 'ping' }, CUBESHOT_SANDBOX_ORIGIN);
     api.log(`${LOG_PREFIX} Ping sent to sandbox`);
}

/**
 * Request current game state from sandbox
 */
function requestSandboxState() {
     if (!sandboxHandle?.isOpen() || !sandboxReady) {
          api.log(`${LOG_PREFIX} Sandbox is not ready`, 'warn');
          return;
     }
     sandboxHandle.sendMessage({ type: 'requestState' }, CUBESHOT_SANDBOX_ORIGIN);
     api.log(`${LOG_PREFIX} State request sent to sandbox`);
}

const initializeEnvironment = async () => {

     const store = api.getStore();

     if (store.environment) {

          store.environment.parameters.timeCycle.enabled = false;
          store.environment.parameters.timeCycle.autoUpdate = false;

          store.environment.createTestPresets();

          await store.environment.bakeLightProbeVolume();

          store.environment.setActiveTimePreset('sun-culmination');

          store.environment.parameters.csm.lightIntensity = 1;

          store.environment.update("csm")

     }
}


Init: {

     const store = api.getStore();

     api.registerImportFormat('cubeshot', { name: 'Cubeshot Map', extensions: ['.json'], import: async () => { await importMap(); return { success: true }; } });
     api.registerExportFormat('cubeshot', { name: 'Cubeshot Map', extension: '.json', export: async () => { await exportMap(); return { success: true }; } });

     api.addMenuItem({ path: 'File/Import cubeshot', callback: importMap });
     api.addMenuItem({ path: 'File/Export cubeshot', callback: exportMap });

     // Sandbox preview menu items
     api.addMenuItem({ path: 'View/Sandbox/Open Preview', callback: openSandboxPreview });
     api.addMenuItem({ path: 'View/Sandbox/Refresh Preview', callback: refreshSandboxPreview });
     api.addMenuItem({ path: 'View/Sandbox/Close Preview', callback: closeSandboxPreview });
     api.addMenuItem({ path: 'View/Sandbox/Start Game', callback: startSandboxGame });
     api.addMenuItem({ path: 'View/Sandbox/Stop Game', callback: stopSandboxGame });
     api.addMenuItem({ path: 'View/Sandbox/Request State', callback: requestSandboxState });
     api.addMenuItem({ path: 'View/Sandbox/Ping', callback: pingSandbox });

     await api.init('New Project', 'A Cubeshot map');

     // api.disableWindow('terminal', 'moduleExplorer');
     // api.lockInspectorGroup('environment', 'scene', 'camera', 'game', 'constraints', 'lightmap');

     // api.disableObject(
     //      'SpawnPoint', 'Terrain', 'ProjectedCubemap', 'NavigationMesh', 'Scatter', 'Grass', 'Water', 'Script', 'Bone', 'GridSystem', 'InstancedMesh', 'AIEntity', 'Audio', 'LODMesh', 'Text', 'Image',
     //      'PerspectiveCamera', 'OrthographicCamera',
     //      'AmbientLight', 'DirectionalLight', 'HemisphereLight', 'PointLight', 'SpotLight',
     //      'shapes'
     // );

     // // Hide unnecessary inspector groups for Cubeshot
     // api.hideInspectorGroup(
     //      'rigidBody',
     //      'inverseKinematics',
     //      'lod',
     //      'audio',
     //      'material',
     //      'texture',
     //      'animation',
     //      'volumes',
     //      'customProperties'
     // );

     // const DEFAULT_FOLDERS_TO_DISABLE = ['materials', 'geometries', 'textures', 'animations', 'audio', 'files', 'scripts'];
     // for (const folderId of DEFAULT_FOLDERS_TO_DISABLE) api.disableFolder(folderId);

     api.disableTextureCreation();
     api.disableMaterialCreation();

     api.registerInspectorComponent({
          name: MAP_SETTINGS_COMPONENT_NAME,
          title: 'Map Settings',
          icon: 'uil uil-map',
          groups: [{
               name: SCALE_GROUP_NAME,
               icon: 'uil uil-expand-arrows-alt',
               options: [
                    {
                         id: ScaleOptions.MAP_SCALE,
                         type: 'number',
                         name: 'Scale (%)',
                         value: 100,
                         options: { min: 10, max: 500, step: 10, input: true }
                    }
               ]
          }],
          priority: 99,
          onChange: (groupName, optionId, value) => {
               if (optionId === ScaleOptions.MAP_SCALE && groupName === SCALE_GROUP_NAME) {
                    // Convert percentage to scale factor (100% = 1.0)
                    const scaleFactor = (value as number) / 100;
                    scaleMap(scaleFactor);
               }
          }
     });

     await api.showDialog('', '', [
          {
               type: "markdown",
               value: WELCOME_MESSAGE,
               label: 'Welcome to CubeShot map making with Lumina'
          },
          IMPORT_FROM_URL_OPTION
     ], { maxWidth: "90%", confirmText: 'Continue' }).promise;

     try {
          await initAssets();
     } catch (error) {
          console.error('[Cubeshot] Failed to initialize custom assets:', error);
     }

     if (IMPORT_FROM_URL_OPTION.value) {

          let loading = api.showDialog('Loading...', IMPORT_FROM_URL_OPTION.value, [], { confirmText: null, maxWidth: "50%" });

          const response = await fetch(IMPORT_FROM_URL_OPTION.value);

          if (response.ok) {

               const blob = await response.blob();

               const text = await blob.text();

               const json = JSON.parse(text) as CubeshotMapData;

               await loading.close();

               loading = api.showDialog(`Importing ${json.name || 'untitled map'}`, `${json.objects.length} objects and ${json.spawns?.length || 0} spawn points `, [], { confirmText: null });

               await importMap(json);

               await loading.close();
          }


     }

     await initializeEnvironment();


     Nodes: {

          if (!store.nodes) break Nodes;

          const [ssao] = store.nodes.getNodesByType("SSAOEffectNode");

          if (!ssao) break Nodes;

          ssao.options.aoSamples.value = 8;
          ssao.options.denoiseSamples.value = 8;
          ssao.options.denoiseRadius.value = 8
          ssao.options.halfRes.value = true;
          ssao.options.depthAwareUpsampling.value = false;

          const [postprocessing] = store.nodes.getNodesByType("PostprocessorNode");

          if (postprocessing) {
               postprocessing.options.multisampling.value = 0;
          }

     }


     store.camera?.position.set(-185, 180, 225)


}

const register = (object: ICSObject) => {

     if (object instanceof CSCubeObject) geometryManager.register(object);
     else if (object instanceof CSMeshObject) meshManager.register(object);

     if (object instanceof ICSObject) helperManager.register(object);

     repo.add(object)
}

const unregister = (object: ICSObject) => {
     if (object instanceof CSCubeObject) geometryManager.remove(object);
     else if (object instanceof CSMeshObject) meshManager.remove(object);

     if (object instanceof ICSObject) helperManager.remove(object);

     repo.delete(object)
}



const handleRegisterState = (cmd: Command, action: 'register' | 'unregister') => {
     if (!(cmd.object instanceof ICSObject)) return;
     if (action === 'register') register(cmd.object);
     else if (action === 'unregister') unregister(cmd.object);
};

const processCommand = (command: Command | ArrayCommand, action: 'apply' | 'revert', init: boolean = false) => {

     if ("list" in command && command.list.length > 0) {

          for (const sub of command.list) processCommand(sub, action);

          return;
     }

     if (init && command.object && repo.has(command.object as ICSObject)) return;

     if (command.type === 'AddObjectCommand') handleRegisterState(command, action === 'apply' ? 'register' : 'unregister');

     else if (command.type === 'RemoveObjectCommand') handleRegisterState(command, action === 'apply' ? 'unregister' : 'register');

};


api.onCommandEvent('undo', ({ command }) => processCommand(command, 'revert'), ["ArrayCommand", "AddObjectCommand", "RemoveObjectCommand"]);

api.onCommandEvent('redo', ({ command }) => processCommand(command, 'apply'), ["ArrayCommand", "AddObjectCommand", "RemoveObjectCommand"]);

api.onCommandEvent('execute', ({ command }) => {

     if ("list" in command == false && command.userData.import == true) return;

     processCommand(command, 'apply', true);

     // @ts-expect-error - requestAnimationFrame is not defined
     requestAnimationFrame(initializeEnvironment);

}, ["ArrayCommand", "AddObjectCommand", "RemoveObjectCommand"]);