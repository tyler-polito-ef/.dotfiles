-- import wezterm
local wezterm = require("wezterm")
local projects = require("projects")

local config = wezterm.config_builder()

config.set_environment_variables = {
	PATH = "/opt/homebrew/bin:" .. os.getenv("PATH"),
}

config.color_scheme = "Darcula (base16)"
config.window_background_opacity = 0.9
config.macos_window_background_blur = 30
-- Removes the title bar, leaving only the tab bar. Keeps
-- the ability to resize by dragging the window's edges.
-- On macOS, 'RESIZE|INTEGRATED_BUTTONS' also looks nice if
-- you want to keep the window controls visible and integrate
-- them into the tab bar.
config.window_decorations = "RESIZE|INTEGRATED_BUTTONS"
-- Sets the font size for the window frame (tab bar)
config.window_frame = {
	font_size = 16,
}
config.font_size = 16

config.leader = { key = "a", mods = "SUPER", timeout_milliseconds = 1000 }

local function move_pane(key, direction)
	return {
		key = key,
		mods = "LEADER",
		action = wezterm.action.ActivatePaneDirection(direction),
	}
end

config.keys = {
	-- Sends ESC + b and ESC + f sequence, which is used
	-- for telling your shell to jump back/forward.
	{
		-- When the left arrow is pressed
		key = "LeftArrow",
		-- With the "Option" key modifier held down
		mods = "OPT",
		-- Perform this action, in this case - sending ESC + B
		-- to the terminal
		action = wezterm.action.SendString("\x1bb"),
	},
	{
		key = "RightArrow",
		mods = "OPT",
		action = wezterm.action.SendString("\x1bf"),
	},
	{
		key = ",",
		mods = "SUPER",
		action = wezterm.action.SpawnCommandInNewTab({
			cwd = wezterm.home_dir,
			args = { "nvim", wezterm.config_file },
		}),
	},
	{
		key = "/",
		mods = "LEADER",
		action = wezterm.action.SplitHorizontal({ domain = "CurrentPaneDomain" }),
	},
	{
		key = "w",
		mods = "LEADER",
		action = wezterm.action.CloseCurrentPane({ confirm = false }),
	},
	{
		key = "q",
		mods = "LEADER",
		action = wezterm.action.ShowTabNavigator,
	},
	{ key = "F9", mods = "ALT", action = wezterm.action.ShowTabNavigator },
	move_pane("j", "Down"),
	move_pane("k", "Up"),
	move_pane("h", "Left"),
	move_pane("l", "Right"),
	{
		key = "p",
		mods = "LEADER",
		-- Present in to our project picker
		action = projects.choose_project(),
	},
	-- IDK if this is needed, but its kidna neat
	-- {
	-- 	key = "f",
	-- 	mods = "LEADER",
	-- 	-- Present a list of existing workspaces
	-- 	action = wezterm.action.ShowLauncherArgs({ flags = "FUZZY|WORKSPACES" }),
	-- },
}

return config
