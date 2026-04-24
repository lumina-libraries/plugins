import { MaterialLoader, MeshStandardMaterial, TextureLoader } from 'three';
import type { IPluginAPI } from "@lumina-engine/types";
import { CustomStoreObject } from "@lumina-engine/store-objects";
import type { StoreFolderAdapter } from '@lumina-engine/store-folders';


declare const api: IPluginAPI;

const loader = new TextureLoader();

const BASE_URL = `https://cdn.jsdelivr.net/gh/lumina-libraries/plugins/prototype-textures`;

const FOLDER_ID = 'prefab-materials';

const GROUPS = ["Dark", "Green", "Light", "Orange", "Purple", "Red"];

const TEXTURE_NAMES = [
     // Top Row
     "Wall (Basic 2x2 Grid)",   // Labeled "WALL" in the corner, featuring a simple grid dividing the tile into four squares.
     "Fine Grid (4x4)",         // A denser grid pattern making up 16 smaller squares.
     "Grid with Crosshairs",    // A standard 2x2 grid with small "+" marks centered inside each quadrant.
     "Plain 2x2 Grid",          // A basic grid identical to the first tile, but without the text label.
     "Diamond Grid",            // A 2x2 grid intersected by diagonal lines that form a diamond shape in the center.
     "Diagonal Cross (X) Grid", // A 2x2 grid with full corner-to-corner diagonal lines forming an "X".

     // Middle Row 
     "Small Checkerboard",      // A 4x4 pattern of alternating light and dark squares.
     "Large Checkerboard",      // A 2x2 pattern of alternating light and dark squares.
     "Faint Crosshairs",        // A solid tile with four very subtle "+" marks.
     "Stairs",                  // Labeled "STAIRS", displaying a side-profile outline of a staircase.
     "Door",                    // Labeled "DOOR", showing the outline of a standard door frame.
     "Window",                  // Labeled "WINDOW", showing the outline of a square window.

     // Bottom Row 
     "floating Crosshairs"      // A plain tile with four distinct "+" marks, similar to tile #3 but without the connecting grid lines.
];

const TEXTURES = GROUPS.map(group => {

     const textures: Array<{ src: string, name: string }> = [];

     for (let i = 1; i <= TEXTURE_NAMES.length; i++) textures.push({
          src: `${BASE_URL}/assets/${group}/texture_${i.toString().padStart(2, "0")}.png`,
          name: `${group} ${TEXTURE_NAMES[i - 1]?.toLowerCase() ?? `texture ${i}`}`
     });

     return textures

}).flat();

const ALREADY_CREATED_MESSAGE = `The prototype materials have already been created. are you sure you want to create them again? This may result in duplicate materials in the store, which could cause confusion when trying to select the correct one for your prefabs. If you want to proceed with creating them again, please confirm your action.`

const LOADING_MESSAGE = `
<div align="center">
  <img src="${BASE_URL}/assets/Sample.png" alt="Sample image" width="200" />
  <h3>Prototype Textures</h3>
</div>
`

class ImportCustomStoreObjectAction extends CustomStoreObject {

     constructor() {

          super();

          this.name = 'Import Prototype Materials';

          this.icon = [`${BASE_URL}/assets/button.png`, "#ff8c00"];
     }

     override async onDoubleClick() {

          const dialog = api.showDialog(
               'Prototype textures',
               'Loading...',
               [{
                    type: "markdown",
                    value: LOADING_MESSAGE,
                    label: 'Confirmation'
               }],
               { maxWidth: "50%", confirmText: 'Continue' }
          );

          await create();

          dialog.close();

          // @ts-ignore
          folder.remove(action)

     }

}

const action = new ImportCustomStoreObjectAction()

const folder = createStoreFolder('Prefab Materials', FOLDER_ID, 2);

let created: boolean = false;

/** Create a store folder with common settings */
function createStoreFolder(name: string, id: string, priority: number, open: boolean = true): StoreFolderAdapter {
     if (api.hasFolder(id)) return api.getFolder(id);
     const folder = api.createFolder(name, id);
     folder.deletable = false;
     folder.priority = priority;
     folder.open = open;
     return folder;
}

async function createMaterial(name: string, url: string) {

     const store = api.getStore();

     const texture = await loader.loadAsync(url)

     const material = MaterialLoader.createMaterialFromType("TriplanarMaterial") as MeshStandardMaterial;

     material.map = texture;

     material.name = name = texture.name = name;

     folder.add(material);

     store.add(texture);
     store.add(material);

     return material;
}

async function create() {

     if (created) await api.showDialog('', '', [
          {
               type: "markdown",
               value: ALREADY_CREATED_MESSAGE,
               label: 'Confirmation'
          },
     ], { maxWidth: "50%", confirmText: 'Continue' }).promise;

     const promises = TEXTURES.map(({ name, src }) => createMaterial(name, src));

     await Promise.all(promises);

     created = true;
}



void async function init() {

     api.addCustomStoreObject(action, folder.id);

}();