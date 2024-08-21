local wezterm = require("wezterm")
local module = {}

local project_dir = wezterm.home_dir .. "/Workspace"

local function project_dirs()
	local projects = { wezterm.home_dir }
	for _, dir in ipairs(wezterm.glob(project_dir .. "/*")) do
		table.insert(projects, dir)
	end
	return projects
end

function module.choose_project()
	local choices = {}
	for _, value in ipairs(project_dirs()) do
		table.insert(choices, { label = value })
	end

	return wezterm.action.InputSelector({
		title = "Projects",
		choices = choices,
		fuzzy = true,
		action = wezterm.action_callback(function(window, pane, id, label)
			if not label then
				return
			end

			-- Instead of switching to a new workspace, we'll change the current directory
			window:perform_action(wezterm.action.SendString("cd " .. label .. "\n"), pane)
			-- Get the last part of the path to use as the tab name
			local tab_name = label:match("([^/]+)$")

			-- Rename the tab
			window:perform_action(wezterm.action.SetTabTitle(tab_name), pane)
		end),
	})
end

return module
