-- Set vim options
local opt = vim.opt

-- Relative line numbers
opt.number = true
opt.relativenumber = true

-- Use system clipboard
opt.clipboard = "unnamedplus"

-- Tabs 2 spaces
opt.tabstop = 2
opt.softtabstop = 2
opt.shiftwidth = 2
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
