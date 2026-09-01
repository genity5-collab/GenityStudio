local button = Instance.new("TextButton")
local function onClick()
    print("clicked")
end
button.MouseButton1Click:Connect(onClick)
