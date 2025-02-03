-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set:
-- https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

vim.keymap.set({ "n", "v" }, "<leader>lf", function()
  LazyVim.format({ force = true })
end, { desc = "Format file" })

vim.keymap.set("n", "<leader>w", function()
  Snacks.bufdelete()
end, { desc = "Close/Delete Buffer" })

vim.keymap.set("n", "<C-p>", LazyVim.pick("files"), { desc = "Find files" })
vim.keymap.set("n", "<leader>ff", LazyVim.pick("live_grep"), { desc = "Find files" })
