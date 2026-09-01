local part = Instance.new("Part")
part.Touched:Connect(function(hit)
  print("Touched")
end)
