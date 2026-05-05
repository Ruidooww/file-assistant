$FileAssistantConfig = @{
  # HTTP port for the server.
  Port = 5177

  # Used only when the database has no admin user yet.
  # For production installers, InitialAdminSetup is set to true so the
  # first admin is created in the web console instead of here.
  AdminUsername = "admin"
  AdminPassword = "change-this-password-before-production"
  InitialAdminSetup = $false

  # Optional legacy token for old scripts that send X-Admin-Token.
  # Leave empty to disable legacy token access.
  AdminToken = "change-this-legacy-token"

  # Relative paths are resolved from the project root.
  DataDir = "data"
  BackupDir = "backups"
  LogDir = "deploy\logs"
  RunDir = "deploy\run"

  # Leave empty to use node.exe from PATH.
  # Example: "C:\Program Files\nodejs\node.exe"
  NodePath = ""

  ServiceName = "FileAssistantServer"
  PublicServerUrl = "http://SERVER-IP:5177"
  ChunkSizeBytes = 2097152
}
