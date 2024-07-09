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
      // If it's a directory, create it at the destination
      await fs.mkdir(destinationPath, { recursive: true });

      // Read the contents of the directory
      const files = await fs.readdir(sourcePath);

      // Recursively copy each item in the directory
      for (const file of files) {
        const srcPath = path.join(sourcePath, file);
        const destPath = path.join(destinationPath, file);
        await copyFileOrDirectory(srcPath, destPath);
      }

      console.log(
        `Directory copied successfully from ${sourcePath} to ${destinationPath}`,
      );
    } else {
      // If it's a file, copy it directly
      // Create the destination directory if it doesn't exist
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });

      // Copy the file
      await fs.copyFile(sourcePath, destinationPath);

      console.log(
        `File copied successfully from ${sourcePath} to ${destinationPath}`,
      );
    }
  } catch (error) {
    console.error("=========================");
    console.error("Error copying files/directories: ", error);
    console.error("=========================");
  }
}

const copyVsCodeFiles = async () => {
  console.log("Copying VS Code settings and keybind files");
  const backupPath = __dirname + "/vscode";
  const settingsPath = `${homeDir}${process.env.VSCODE_SETTINGS}`;
  const keybindsPath = `${homeDir}${process.env.VSCODE_KEYBINDS}`;

  await copyFileOrDirectory(settingsPath, `${backupPath}/settings.json`);
  await copyFileOrDirectory(keybindsPath, `${backupPath}/keybindings.json`);

  console.log("Done copying VS Code files");
};

const copyZshFiles = async () => {
  console.log("Copying ZSH settings files");
  const backupPath = __dirname + "/zsh";
  const zshrcPath = `${homeDir}${process.env.ZSHRC}`;

  await copyFileOrDirectory(zshrcPath, `${backupPath}/zsh`);

  console.log("Done copying ZSH files");
};

const copyZedFiles = async () => {
  console.log("Copying Zed settings files");
  const backupPath = __dirname + "/zed";
  const settingsPath = `${homeDir}${process.env.ZED_SETTINGS}`;
  const keymapPath = `${homeDir}${process.env.ZED_KEYMAP}`;
  const themesPath = `${homeDir}${process.env.ZED_THEMES}`;

  await copyFileOrDirectory(settingsPath, `${backupPath}/settings.json`);
  await copyFileOrDirectory(keymapPath, `${backupPath}/keymap.json`);
  await copyFileOrDirectory(themesPath, `${backupPath}/themes`);

  console.log("Done copying Zed files");
};

const copyAlacrittyFiles = async () => {
  console.log("Copying Alacritty settings files");
  const backupPath = __dirname + "/alacritty";
  const alacrittyPath = `${homeDir}${process.env.ALACRITTY_CONFIG}`;

  await copyFileOrDirectory(alacrittyPath, `${backupPath}/alacritty.toml`);

  console.log("Done copying Alacritty files");
};

const copyNvimFiles = async () => {
  console.log("Copying Neovim settings files");
  const backupPath = __dirname + "/nvim";
  const nvimPath = `${homeDir}${process.env.NVIM_CONFIG}`;

  await copyFileOrDirectory(nvimPath, backupPath);

  console.log("Done copying Neovim files");
};

const main = async () => {
  copyVsCodeFiles();
  copyZshFiles();
  copyZedFiles();
  copyAlacrittyFiles();
  copyNvimFiles();
};

main();
