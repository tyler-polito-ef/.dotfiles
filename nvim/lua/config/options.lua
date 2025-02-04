-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here

-- global leader
vim.g.mapleader = "'"

-- Set vim options
local opt = vim.opt

-- Relative line numbers
opt.number = true
opt.relativenumber = true

-- Use system clipboard
opt.clipboard = "unnamedplus"

-- Tabs 4 spaces (VSCode default)
opt.tabstop = 4
opt.softtabstop = 4
opt.shiftwidth = 4
opt.expandtab = true

-- Smart indenting
opt.smartindent = true

-- Enable mouse
opt.mouse = "a"

-- Search
-- ignorecase and smartcase to make search feel better
-- disable highlight search
opt.ignorecase = true
opt.smartcase = true
opt.hlsearch = false
opt.incsearch = true

-- persistant undo
opt.undofile = true

-- 24bit color
opt.termguicolors = true

-- scrolloff
opt.scrolloff = 8

-- decrease update time (I think this is 200ms)
opt.updatetime = 50

-- TODO: Move this to autocmds
vim.api.nvim_create_autocmd("FileType", {
  pattern = "gdscript",
  callback = function()
    vim.opt_local.tabstop = 2
    vim.opt_local.softtabstop = 2
    vim.opt_local.shiftwidth = 2
  end,
})
