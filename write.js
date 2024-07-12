/*
  This script will copy all of the various config files listed here and update the directoryies
  Should be invoked on a system with node installed via `node --env-file=./scripts/paths.env scripts/copy.js`
*/
const fs = require("fs").promises;
const path = require("path");
const os = require("os");

const homeDir = os.homedir();

async function copyFileOrDirectory(sourcePath, destinationPath) {
  try {
    const stats = await fs.stat(sourcePath);
    if (stats.isDirectory()) {
      await fs.mkdir(destinationPath, { recursive: true });
      const files = await fs.readdir(sourcePath);
      for (const file of files) {
        const srcPath = path.join(sourcePath, file);
        const destPath = path.join(destinationPath, file);
        await copyFileOrDirectory(srcPath, destPath);
      }
      console.log(`Directory written successfully to ${destinationPath}`);
    } else {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.copyFile(sourcePath, destinationPath);
      console.log(`File written successfully to ${destinationPath}`);
    }
  } catch (error) {
    console.error("=========================");
    console.error("Error writing files/directories: ", error);
    console.error("=========================");
  }
}

const writeVsCodeFiles = async () => {
  console.log("Writing VS Code settings and keybind files");
  const sourcePath = __dirname + "/vscode";
  const settingsPath = `${homeDir}${process.env.VSCODE_SETTINGS}`;
  const keybindsPath = `${homeDir}${process.env.VSCODE_KEYBINDS}`;
  await copyFileOrDirectory(`${sourcePath}/settings.json`, settingsPath);
  await copyFileOrDirectory(`${sourcePath}/keybindings.json`, keybindsPath);
  console.log("Done writing VS Code files");
};

const writeZshFiles = async () => {
  console.log("Writing ZSH settings files");
  const sourcePath = __dirname + "/zsh/zsh";
  const zshrcPath = `${homeDir}${process.env.ZSHRC}`;
  await copyFileOrDirectory(sourcePath, zshrcPath);
  console.log("Done writing ZSH files");
};

const writeZedFiles = async () => {
  console.log("Writing Zed settings files");
  const sourcePath = __dirname + "/zed";
  const settingsPath = `${homeDir}${process.env.ZED_SETTINGS}`;
  const keymapPath = `${homeDir}${process.env.ZED_KEYMAP}`;
  const themesPath = `${homeDir}${process.env.ZED_THEMES}`;
  await copyFileOrDirectory(`${sourcePath}/settings.json`, settingsPath);
  await copyFileOrDirectory(`${sourcePath}/keymap.json`, keymapPath);
  await copyFileOrDirectory(`${sourcePath}/themes`, themesPath);
  console.log("Done writing Zed files");
};

const writeAlacrittyFiles = async () => {
  console.log("Writing Alacritty settings files");
  const sourcePath = __dirname + "/alacritty/alacritty.toml";
  const alacrittyPath = `${homeDir}${process.env.ALACRITTY_CONFIG}`;
  await copyFileOrDirectory(sourcePath, alacrittyPath);
  console.log("Done writing Alacritty files");
};

const writeNvimFiles = async () => {
  console.log("Writing Neovim settings files");
  const sourcePath = __dirname + "/nvim";
  const nvimPath = `${homeDir}${process.env.NVIM_CONFIG}`;
  await copyFileOrDirectory(sourcePath, nvimPath);
  console.log("Done writing Neovim files");
};

const main = async () => {
  // await writeVsCodeFiles();
  // await writeZshFiles();
  await writeZedFiles();
  // await writeAlacrittyFiles();
  // await writeNvimFiles();
};

main();
