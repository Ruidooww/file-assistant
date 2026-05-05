namespace FileAssistant.WinClient;

public sealed class MainForm : Form
{
    private readonly ClientConfig _config;
    private readonly ClientBootstrapOptions _bootstrapOptions;
    private readonly FileAssistantApiClient _apiClient;
    private readonly TextBox _serverText = new();
    private readonly TextBox _installCodeText = new();
    private readonly TextBox _displayNameText = new();
    private readonly TextBox _macText = new();
    private readonly TextBox _ipText = new();
    private readonly TextBox _fileText = new();
    private readonly TextBox _noteText = new();
    private readonly TextBox _receiveDirText = new();
    private readonly TextBox _logText = new();
    private readonly Label _meLabel = new();
    private readonly Label _progressLabel = new();
    private readonly ComboBox _recipientCombo = new();
    private readonly CheckBox _backupCheck = new();
    private readonly ProgressBar _uploadProgress = new();
    private readonly DataGridView _transferGrid = new();
    private readonly Button _registerButton = new();
    private readonly Button _detectButton = new();
    private readonly Button _testButton = new();
    private readonly Button _resetButton = new();
    private readonly Button _browseFileButton = new();
    private readonly Button _uploadButton = new();
    private readonly Button _browseDirButton = new();
    private readonly Button _refreshButton = new();
    private readonly Button _receiveButton = new();
    private readonly System.Windows.Forms.Timer _pollTimer = new();
    private readonly NotifyIcon _notifyIcon = new();
    private readonly HashSet<string> _knownReadyInboxTransferIds = new(StringComparer.Ordinal);

    private ClientDto? _me;
    private IReadOnlyList<RecipientDto> _recipients = [];
    private IReadOnlyList<TransferDto> _transfers = [];
    private bool _initialRefreshCompleted;
    private bool _refreshInProgress;
    private bool _isBusy;
    private bool _useAutoRegisterEndpointForNextRegistration;
    private DateTime _lastPollErrorAt = DateTime.MinValue;

    public MainForm()
    {
        _config = ClientConfigStore.Load();
        _bootstrapOptions = ClientBootstrapOptions.Load();
        ApplyBootstrapOptions();
        _apiClient = new FileAssistantApiClient(_config);

        Text = "File Assistant Windows Client";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(1080, 800);
        Size = new Size(1120, 820);
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

        _pollTimer.Interval = 10_000;
        _notifyIcon.Icon = SystemIcons.Information;
        _notifyIcon.Text = "File Assistant Client";
        _notifyIcon.Visible = true;

        BuildUi();
        ConfigureControlSizing(this);
        LoadConfigToFields();
        ApplyConfigurationLockState();
        RenderIdentity();
        WireEvents();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _pollTimer.Stop();
            _pollTimer.Dispose();
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
            _apiClient.Dispose();
        }

        base.Dispose(disposing);
    }

    private void BuildUi()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 4,
            Padding = new Padding(12)
        };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 148));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 218));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 78));
        Controls.Add(root);

        root.Controls.Add(BuildConnectionGroup(), 0, 0);
        root.Controls.Add(BuildUploadGroup(), 0, 1);
        root.Controls.Add(BuildTransferGroup(), 0, 2);
        root.Controls.Add(BuildLogGroup(), 0, 3);
    }

    private Control BuildConnectionGroup()
    {
        var group = new GroupBox
        {
            Text = "连接与注册",
            Dock = DockStyle.Fill
        };

        var grid = CreateGrid(3, 8);
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 82));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 30));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 72));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 22));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 82));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 26));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 108));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 108));
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 35));
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 35));
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 35));
        group.Controls.Add(grid);

        AddLabel(grid, "服务地址", 0, 0);
        grid.Controls.Add(_serverText, 1, 0);
        grid.SetColumnSpan(_serverText, 3);

        AddLabel(grid, "安装码", 4, 0);
        grid.Controls.Add(_installCodeText, 5, 0);

        _registerButton.Text = "注册";
        grid.Controls.Add(_registerButton, 6, 0);

        _testButton.Text = "保存/检测";
        grid.Controls.Add(_testButton, 7, 0);

        AddLabel(grid, "显示名称", 0, 1);
        grid.Controls.Add(_displayNameText, 1, 1);
        grid.SetColumnSpan(_displayNameText, 3);

        AddLabel(grid, "MAC", 4, 1);
        grid.Controls.Add(_macText, 5, 1);

        _detectButton.Text = "重读设备";
        grid.Controls.Add(_detectButton, 6, 1);

        _resetButton.Text = "维护重置";
        grid.Controls.Add(_resetButton, 7, 1);

        AddLabel(grid, "IP", 0, 2);
        grid.Controls.Add(_ipText, 1, 2);

        _meLabel.AutoEllipsis = true;
        _meLabel.Dock = DockStyle.Fill;
        _meLabel.TextAlign = ContentAlignment.MiddleLeft;
        grid.Controls.Add(_meLabel, 2, 2);
        grid.SetColumnSpan(_meLabel, 6);

        return group;
    }

    private Control BuildUploadGroup()
    {
        var group = new GroupBox
        {
            Text = "发送文件",
            Dock = DockStyle.Fill
        };

        var grid = CreateGrid(5, 8);
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 82));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 34));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 26));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 128));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 128));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 94));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 94));
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        group.Controls.Add(grid);

        AddLabel(grid, "接收人员", 0, 0);
        _recipientCombo.DropDownStyle = ComboBoxStyle.DropDownList;
        grid.Controls.Add(_recipientCombo, 1, 0);
        grid.SetColumnSpan(_recipientCombo, 3);

        _backupCheck.Text = "重要备份";
        _backupCheck.Dock = DockStyle.Fill;
        grid.Controls.Add(_backupCheck, 4, 0);

        _refreshButton.Text = "刷新";
        grid.Controls.Add(_refreshButton, 5, 0);

        AddLabel(grid, "本地文件", 0, 1);
        grid.Controls.Add(_fileText, 1, 1);
        grid.SetColumnSpan(_fileText, 5);

        _browseFileButton.Text = "选择";
        grid.Controls.Add(_browseFileButton, 6, 1);

        _uploadButton.Text = "上传";
        grid.Controls.Add(_uploadButton, 7, 1);

        AddLabel(grid, "备注", 0, 2);
        grid.Controls.Add(_noteText, 1, 2);
        grid.SetColumnSpan(_noteText, 7);

        AddLabel(grid, "进度", 0, 3);

        _uploadProgress.Dock = DockStyle.Fill;
        _uploadProgress.Margin = new Padding(6, 4, 6, 4);
        _uploadProgress.Minimum = 0;
        _uploadProgress.Maximum = 100;
        grid.Controls.Add(_uploadProgress, 1, 3);
        grid.SetColumnSpan(_uploadProgress, 7);

        _progressLabel.Text = "等待操作";
        _progressLabel.TextAlign = ContentAlignment.MiddleLeft;
        _progressLabel.Dock = DockStyle.Fill;
        grid.Controls.Add(_progressLabel, 1, 4);
        grid.SetColumnSpan(_progressLabel, 7);

        return group;
    }

    private Control BuildTransferGroup()
    {
        var group = new GroupBox
        {
            Text = "接收与状态",
            Dock = DockStyle.Fill
        };

        var grid = CreateGrid(2, 6);
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 82));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 94));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 94));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 94));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130));
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        grid.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        group.Controls.Add(grid);

        AddLabel(grid, "落地目录", 0, 0);
        grid.Controls.Add(_receiveDirText, 1, 0);
        grid.SetColumnSpan(_receiveDirText, 2);

        _browseDirButton.Text = "选择";
        grid.Controls.Add(_browseDirButton, 3, 0);

        _receiveButton.Text = "接收选中";
        grid.Controls.Add(_receiveButton, 4, 0);

        _transferGrid.AllowUserToAddRows = false;
        _transferGrid.AllowUserToDeleteRows = false;
        _transferGrid.AllowUserToResizeRows = false;
        _transferGrid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        _transferGrid.BackgroundColor = SystemColors.Window;
        _transferGrid.BorderStyle = BorderStyle.Fixed3D;
        _transferGrid.ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.AutoSize;
        _transferGrid.Dock = DockStyle.Fill;
        _transferGrid.MultiSelect = false;
        _transferGrid.ReadOnly = true;
        _transferGrid.RowHeadersVisible = false;
        _transferGrid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        _transferGrid.Columns.Add(CreateColumn("role", "方向", 76));
        _transferGrid.Columns.Add(CreateColumn("file", "文件", 240));
        _transferGrid.Columns.Add(CreateColumn("peer", "对方", 150));
        _transferGrid.Columns.Add(CreateColumn("status", "流程状态", 105));
        _transferGrid.Columns.Add(CreateColumn("delivery", "接收状态", 100));
        _transferGrid.Columns.Add(CreateColumn("server", "服务器文件", 105));
        _transferGrid.Columns.Add(CreateColumn("size", "大小", 86));
        _transferGrid.Columns.Add(CreateColumn("backup", "备份", 60));
        grid.Controls.Add(_transferGrid, 0, 1);
        grid.SetColumnSpan(_transferGrid, 6);

        return group;
    }

    private Control BuildLogGroup()
    {
        var group = new GroupBox
        {
            Text = "本地日志",
            Dock = DockStyle.Fill
        };

        _logText.Dock = DockStyle.Fill;
        _logText.Multiline = true;
        _logText.ReadOnly = true;
        _logText.ScrollBars = ScrollBars.Vertical;
        group.Controls.Add(_logText);
        return group;
    }

    private static TableLayoutPanel CreateGrid(int rows, int columns)
    {
        return new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = columns,
            RowCount = rows,
            Padding = new Padding(10),
            Margin = new Padding(0)
        };
    }

    private static void AddLabel(TableLayoutPanel grid, string text, int column, int row)
    {
        var label = new Label
        {
            Text = text,
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft
        };
        grid.Controls.Add(label, column, row);
    }

    private static void ConfigureControlSizing(Control root)
    {
        foreach (Control control in root.Controls)
        {
            ConfigureControlSizing(control);

            switch (control)
            {
                case Button button:
                    button.Dock = DockStyle.Fill;
                    button.Margin = new Padding(6, 3, 6, 3);
                    button.MinimumSize = new Size(88, 28);
                    button.UseVisualStyleBackColor = true;
                    break;

                case TextBox textBox when !textBox.Multiline:
                    textBox.Dock = DockStyle.Fill;
                    textBox.Margin = new Padding(6, 4, 6, 4);
                    break;

                case ComboBox comboBox:
                    comboBox.Dock = DockStyle.Fill;
                    comboBox.Margin = new Padding(6, 4, 6, 4);
                    comboBox.DropDownWidth = Math.Max(comboBox.DropDownWidth, 260);
                    break;

                case CheckBox checkBox:
                    checkBox.Dock = DockStyle.Fill;
                    checkBox.Margin = new Padding(8, 3, 8, 3);
                    break;

                case Label label:
                    label.Margin = new Padding(4, 2, 4, 2);
                    break;
            }
        }
    }

    private static DataGridViewTextBoxColumn CreateColumn(string name, string header, int width)
    {
        return new DataGridViewTextBoxColumn
        {
            Name = name,
            HeaderText = header,
            FillWeight = width,
            SortMode = DataGridViewColumnSortMode.NotSortable
        };
    }

    private void WireEvents()
    {
        _registerButton.Click += async (_, _) => await RunUiActionAsync(RegisterClientAsync);
        _detectButton.Click += (_, _) => RunUiAction(DetectDevice);
        _testButton.Click += async (_, _) => await RunUiActionAsync(SaveAndTestAsync);
        _resetButton.Click += (_, _) => RunUiAction(ResetRegistration);
        _browseFileButton.Click += (_, _) => RunUiAction(BrowseFile);
        _uploadButton.Click += async (_, _) => await RunUiActionAsync(UploadSelectedFileAsync);
        _browseDirButton.Click += (_, _) => RunUiAction(BrowseReceiveDirectory);
        _refreshButton.Click += async (_, _) => await RunUiActionAsync(RefreshDataAsync);
        _receiveButton.Click += async (_, _) => await RunUiActionAsync(ReceiveSelectedTransferAsync);
        _pollTimer.Tick += async (_, _) => await PollServerAsync();
        _notifyIcon.DoubleClick += (_, _) => RestoreWindow();
        Shown += async (_, _) =>
        {
            if (!_config.HasCredentials && _bootstrapOptions.AutoRegister && !string.IsNullOrWhiteSpace(_bootstrapOptions.RegistrationToken))
            {
                _useAutoRegisterEndpointForNextRegistration = true;
                await RunUiActionAsync(RegisterClientAsync);
                _useAutoRegisterEndpointForNextRegistration = false;
            }
            else if (_config.HasCredentials)
            {
                await RunUiActionAsync(RefreshDataAsync);
            }

            _pollTimer.Start();
        };
    }

    private void ApplyBootstrapOptions()
    {
        if (_config.HasCredentials)
        {
            return;
        }

        if (!string.IsNullOrWhiteSpace(_bootstrapOptions.ServerUrl))
        {
            _config.ServerUrl = NormalizeServerUrl(_bootstrapOptions.ServerUrl);
        }

        if (!string.IsNullOrWhiteSpace(_bootstrapOptions.DisplayName))
        {
            _config.DisplayName = _bootstrapOptions.DisplayName.Trim();
        }

        if (!string.IsNullOrWhiteSpace(_bootstrapOptions.ReceiveDir))
        {
            _config.ReceiveDir = _bootstrapOptions.ReceiveDir.Trim();
        }

        var device = DeviceInfo.Detect();
        _config.MacAddress = device.MacAddress;
        _config.IpAddress = device.IpAddress;
    }

    private void LoadConfigToFields()
    {
        _serverText.Text = _config.ServerUrl;
        _installCodeText.Text = _config.HasCredentials ? "" : _bootstrapOptions.RegistrationToken;
        _displayNameText.Text = _config.DisplayName;
        _macText.Text = _config.MacAddress;
        _ipText.Text = _config.IpAddress;
        _receiveDirText.Text = _config.ReceiveDir;
    }

    private void SyncConfigFromFields()
    {
        if (!_config.HasCredentials)
        {
            _config.ServerUrl = NormalizeServerUrl(_serverText.Text);
            _config.DisplayName = _displayNameText.Text.Trim();
            _config.MacAddress = _macText.Text.Trim();
            _config.IpAddress = _ipText.Text.Trim();
        }

        _config.ReceiveDir = _receiveDirText.Text.Trim();
        _serverText.Text = _config.ServerUrl;
        _apiClient.UpdateConfig(_config);
    }

    private void ApplyConfigurationLockState()
    {
        var locked = _config.HasCredentials;
        _serverText.ReadOnly = locked;
        _installCodeText.ReadOnly = locked;
        _installCodeText.Enabled = !locked;
        _displayNameText.ReadOnly = locked;
        _macText.ReadOnly = locked;
        _ipText.ReadOnly = locked;

        if (locked)
        {
            _installCodeText.Text = "";
        }

        _registerButton.Enabled = !locked && !_isBusy;
        _detectButton.Enabled = !locked && !_isBusy;
        _resetButton.Visible = _bootstrapOptions.MaintenanceMode && _config.HasCredentials;
        _resetButton.Enabled = _resetButton.Visible && !_isBusy;
        _testButton.Text = locked ? "检测连接" : "保存/检测";
    }

    private static string NormalizeServerUrl(string value)
    {
        value = value.Trim();
        return string.IsNullOrWhiteSpace(value) ? "http://localhost:5177" : value.TrimEnd('/');
    }

    private async Task RegisterClientAsync()
    {
        if (_config.HasCredentials)
        {
            throw new InvalidOperationException("客户端已注册，关键配置已锁定。需要重新注册时请联系管理员下发维护操作。");
        }

        SyncConfigFromFields();
        var registrationToken = _installCodeText.Text.Trim();
        if (string.IsNullOrWhiteSpace(registrationToken))
        {
            registrationToken = _bootstrapOptions.RegistrationToken.Trim();
        }

        if (string.IsNullOrWhiteSpace(registrationToken))
        {
            throw new InvalidOperationException("请输入安装码，或通过部署参数下发部署令牌。");
        }

        if (string.IsNullOrWhiteSpace(_config.DisplayName))
        {
            throw new InvalidOperationException("请输入显示名称。");
        }

        SetBusy(true, "正在注册...");
        var device = DeviceInfo.Detect();
        var request = new RegisterClientRequest
        {
            InstallCode = _bootstrapOptions.TokenKind == "deploy-token" ? "" : registrationToken,
            DeployToken = _bootstrapOptions.TokenKind == "deploy-token" ? registrationToken : "",
            DisplayName = _config.DisplayName,
            MacAddress = _config.MacAddress,
            IpAddress = _config.IpAddress,
            Platform = device.Platform
        };
        var result = _useAutoRegisterEndpointForNextRegistration
            ? await _apiClient.AutoRegisterClientAsync(request)
            : await _apiClient.RegisterClientAsync(request);

        if (result?.Client is null || string.IsNullOrWhiteSpace(result.ClientSecret))
        {
            throw new InvalidOperationException("注册响应缺少客户端凭证。");
        }

        _config.ClientId = result.Client.Id;
        _config.ClientSecret = result.ClientSecret;
        _config.MacAddress = result.Client.MacAddress;
        _config.IpAddress = result.Client.IpAddress;
        _installCodeText.Text = "";
        _macText.Text = _config.MacAddress;
        _ipText.Text = _config.IpAddress;
        ClientConfigStore.Save(_config);
        ApplyConfigurationLockState();
        Log("注册成功，凭证已保存，关键配置已锁定。请在管理端绑定人员后刷新。");
        await RefreshDataAsync();
    }

    private async Task SaveAndTestAsync()
    {
        SyncConfigFromFields();
        ClientConfigStore.Save(_config);
        SetBusy(true, "正在检测服务...");
        var health = await _apiClient.GetHealthAsync();
        Log($"服务连接正常：{health?.At}");

        if (_config.HasCredentials)
        {
            await RefreshDataAsync();
        }

        ApplyConfigurationLockState();
    }

    private void DetectDevice()
    {
        if (_config.HasCredentials)
        {
            throw new InvalidOperationException("客户端已注册，设备信息已锁定。需要变更时请联系管理员。");
        }

        var device = DeviceInfo.Detect();
        _displayNameText.Text = string.IsNullOrWhiteSpace(_displayNameText.Text)
            ? $"{device.MachineName}\\{device.UserName}"
            : _displayNameText.Text;
        _macText.Text = device.MacAddress;
        _ipText.Text = device.IpAddress;
        SyncConfigFromFields();
        ClientConfigStore.Save(_config);
        Log("已重新读取本机设备信息。");
    }

    private void ResetRegistration()
    {
        if (!_bootstrapOptions.MaintenanceMode)
        {
            throw new InvalidOperationException("未启用维护模式。请由管理员使用 --maintenance 启动客户端。");
        }

        if (!_config.HasCredentials)
        {
            throw new InvalidOperationException("当前客户端尚未注册。");
        }

        var confirm = MessageBox.Show(
            this,
            "确认清除本机注册凭证并解除配置锁定？清除后需要重新注册。",
            "维护重置",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning);
        if (confirm != DialogResult.Yes)
        {
            return;
        }

        _config.ClientId = "";
        _config.ClientSecret = "";
        if (!string.IsNullOrWhiteSpace(_bootstrapOptions.ServerUrl))
        {
            _config.ServerUrl = NormalizeServerUrl(_bootstrapOptions.ServerUrl);
        }

        if (!string.IsNullOrWhiteSpace(_bootstrapOptions.DisplayName))
        {
            _config.DisplayName = _bootstrapOptions.DisplayName.Trim();
        }

        var device = DeviceInfo.Detect();
        _config.MacAddress = device.MacAddress;
        _config.IpAddress = device.IpAddress;
        _me = null;
        _recipients = [];
        _transfers = [];
        _knownReadyInboxTransferIds.Clear();
        _initialRefreshCompleted = false;
        ClientConfigStore.Save(_config);
        LoadConfigToFields();
        RenderIdentity();
        RenderRecipients();
        RenderTransfers();
        ApplyConfigurationLockState();
        Log("已清除本机注册凭证，关键配置已解除锁定。");
    }

    private async Task RefreshDataAsync()
    {
        await RefreshDataAsync(silent: false);
    }

    private async Task RefreshDataAsync(bool silent)
    {
        if (_refreshInProgress)
        {
            return;
        }

        _refreshInProgress = true;
        SyncConfigFromFields();

        try
        {
            if (!_config.HasCredentials)
            {
                RenderIdentity();
                if (silent)
                {
                    return;
                }

                throw new InvalidOperationException("请先注册客户端。");
            }

            ClientConfigStore.Save(_config);
            if (!silent)
            {
                SetBusy(true, "正在刷新...");
            }

            var meTask = _apiClient.GetMeAsync();
            var recipientsTask = _apiClient.GetRecipientsAsync();
            var transfersTask = _apiClient.GetTransfersAsync();

            await Task.WhenAll(meTask, recipientsTask, transfersTask);
            _me = meTask.Result;
            _recipients = recipientsTask.Result;
            _transfers = transfersTask.Result;

            var newReadyTransfers = GetNewReadyInboxTransfers(_transfers).ToList();

            RenderIdentity();
            RenderRecipients();
            RenderTransfers();
            RememberReadyInboxTransfers(_transfers);
            ApplyConfigurationLockState();

            if (!silent)
            {
                Log("已刷新客户端状态、接收人员和传输列表。");
            }

            NotifyNewReadyTransfers(newReadyTransfers);
        }
        finally
        {
            _refreshInProgress = false;
        }
    }

    private async Task PollServerAsync()
    {
        if (_isBusy || _refreshInProgress || !_config.HasCredentials)
        {
            return;
        }

        try
        {
            await RefreshDataAsync(silent: true);
        }
        catch (Exception ex)
        {
            if ((DateTime.Now - _lastPollErrorAt).TotalSeconds >= 60)
            {
                _lastPollErrorAt = DateTime.Now;
                Log("自动刷新失败：" + ex.Message);
            }
        }
    }

    private void BrowseFile()
    {
        using var dialog = new OpenFileDialog
        {
            Title = "选择要发送的文件",
            CheckFileExists = true,
            Multiselect = false
        };

        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            _fileText.Text = dialog.FileName;
        }
    }

    private async Task UploadSelectedFileAsync()
    {
        SyncConfigFromFields();
        if (!_config.HasCredentials)
        {
            throw new InvalidOperationException("请先注册客户端。");
        }

        if (_recipientCombo.SelectedItem is not RecipientDto recipient)
        {
            throw new InvalidOperationException("请选择接收人员。");
        }

        var filePath = _fileText.Text.Trim();
        if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
        {
            throw new InvalidOperationException("请选择有效的本地文件。");
        }

        var fileInfo = new FileInfo(filePath);
        SetBusy(true, "正在初始化上传...");
        _uploadProgress.Value = 0;

        var init = await _apiClient.InitTransferAsync(new InitTransferRequest
        {
            ReceiverEmployeeId = recipient.Id,
            FileName = fileInfo.Name,
            MimeType = "application/octet-stream",
            Size = fileInfo.Length,
            RetainOnServer = _backupCheck.Checked,
            UploadNote = _noteText.Text.Trim(),
            Controls = new TransferControlsRequest
            {
                Receiver = new ReceiverControlsRequest
                {
                    AllowReceive = true,
                    AllowPreview = false,
                    AllowScreenshot = true
                }
            }
        });

        var transfer = init?.Transfer ?? throw new InvalidOperationException("服务端未返回传输任务。");
        var chunkSize = transfer.ChunkSize > 0 ? transfer.ChunkSize : init.ChunkSize;
        if (chunkSize <= 0)
        {
            throw new InvalidOperationException("服务端返回的分片大小无效。");
        }

        var missingChunks = init.MissingChunks.Length == 0
            ? Enumerable.Range(0, Math.Max(1, transfer.TotalChunks)).ToArray()
            : init.MissingChunks;

        await using var stream = new FileStream(fileInfo.FullName, FileMode.Open, FileAccess.Read, FileShare.Read, chunkSize, true);
        for (var position = 0; position < missingChunks.Length; position++)
        {
            var chunkIndex = missingChunks[position];
            var offset = (long)chunkIndex * chunkSize;
            var length = (int)Math.Max(0, Math.Min(chunkSize, fileInfo.Length - offset));
            var buffer = new byte[length];

            stream.Seek(offset, SeekOrigin.Begin);
            var totalRead = 0;
            while (totalRead < length)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(totalRead, length - totalRead));
                if (read == 0)
                {
                    break;
                }

                totalRead += read;
            }

            if (totalRead != buffer.Length)
            {
                Array.Resize(ref buffer, totalRead);
            }

            var percent = (int)Math.Round(((double)(position + 1) / missingChunks.Length) * 100);
            SetProgress(percent, $"上传分片 {chunkIndex + 1}/{transfer.TotalChunks}");
            await _apiClient.UploadChunkAsync(transfer.Id, chunkIndex, buffer);
        }

        SetProgress(100, "上传完成");
        Log($"上传完成：{fileInfo.Name}");
        await RefreshDataAsync();
    }

    private void BrowseReceiveDirectory()
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "选择接收文件落地目录",
            SelectedPath = Directory.Exists(_receiveDirText.Text) ? _receiveDirText.Text : ""
        };

        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            _receiveDirText.Text = dialog.SelectedPath;
            SyncConfigFromFields();
            ClientConfigStore.Save(_config);
        }
    }

    private async Task ReceiveSelectedTransferAsync()
    {
        SyncConfigFromFields();
        if (!_config.HasCredentials)
        {
            throw new InvalidOperationException("请先注册客户端。");
        }

        var transfer = GetSelectedTransfer();
        if (transfer is null)
        {
            throw new InvalidOperationException("请选择一条发给我的传输记录。");
        }

        if (!string.Equals(transfer.ReceiverId, _config.ClientId, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("只能接收发给当前客户端的文件。");
        }

        if (transfer.Status is not ("approved" or "ready_to_deliver"))
        {
            throw new InvalidOperationException("该文件还没有准备好接收。");
        }

        if (string.Equals(transfer.ServerFileStatus, "purged", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("服务器上的文件已经清除。");
        }

        var receiveDir = string.IsNullOrWhiteSpace(_config.ReceiveDir)
            ? ClientConfigStore.Load().ReceiveDir
            : _config.ReceiveDir;
        Directory.CreateDirectory(receiveDir);

        var targetPath = GetUniquePath(Path.Combine(receiveDir, GetSafeFileName(transfer.FileName)));
        var tempPath = targetPath + ".fa-download";
        if (File.Exists(tempPath))
        {
            File.Delete(tempPath);
        }

        SetBusy(true, "正在接收...");
        Log($"开始接收：{transfer.FileName}");
        try
        {
            await _apiClient.DownloadTransferFileAsync(transfer.Id, tempPath);
            File.Move(tempPath, targetPath, true);

            if (!File.Exists(targetPath))
            {
                throw new InvalidOperationException("文件写入失败，未向服务端确认接收。");
            }

            var actualSize = new FileInfo(targetPath).Length;
            if (transfer.Size >= 0 && actualSize != transfer.Size)
            {
                throw new InvalidOperationException($"文件大小校验失败，期望 {transfer.Size}，实际 {actualSize}，未向服务端确认接收。");
            }

            await _apiClient.ConfirmDeliveryAsync(transfer.Id, targetPath);
            Log($"接收完成并已确认：{targetPath}");
        }
        catch
        {
            if (File.Exists(tempPath))
            {
                File.Delete(tempPath);
            }

            throw;
        }

        await RefreshDataAsync();
    }

    private TransferDto? GetSelectedTransfer()
    {
        if (_transferGrid.SelectedRows.Count == 0)
        {
            return null;
        }

        return _transferGrid.SelectedRows[0].Tag as TransferDto;
    }

    private void RenderIdentity()
    {
        if (_me is null)
        {
            _meLabel.Text = _config.HasCredentials
                ? "已保存客户端凭证，关键配置已锁定，尚未完成连接检测。"
                : "尚未注册。请先在管理端生成安装码，然后注册客户端。";
            return;
        }

        var employeeText = string.IsNullOrWhiteSpace(_me.EmployeeId) ? "未绑定人员" : $"人员ID: {_me.EmployeeId}";
        _meLabel.Text = $"客户端：{_me.DisplayName} / {_me.Status} / {employeeText} / 已锁定 / MAC {_me.MacAddress} / IP {_me.IpAddress}";
    }

    private void RenderRecipients()
    {
        _recipientCombo.Items.Clear();
        foreach (var recipient in _recipients)
        {
            _recipientCombo.Items.Add(recipient);
        }

        if (_recipientCombo.Items.Count > 0)
        {
            _recipientCombo.SelectedIndex = 0;
        }
    }

    private void RenderTransfers()
    {
        _transferGrid.Rows.Clear();
        foreach (var transfer in _transfers)
        {
            var role = "-";
            var peer = "";

            if (string.Equals(transfer.SenderId, _config.ClientId, StringComparison.Ordinal))
            {
                role = "我发送";
                peer = string.IsNullOrWhiteSpace(transfer.ReceiverEmployeeName) ? transfer.ReceiverName : transfer.ReceiverEmployeeName;
            }
            else if (string.Equals(transfer.ReceiverId, _config.ClientId, StringComparison.Ordinal))
            {
                role = "发给我";
                peer = string.IsNullOrWhiteSpace(transfer.SenderEmployeeName) ? transfer.SenderName : transfer.SenderEmployeeName;
            }

            var index = _transferGrid.Rows.Add(
                role,
                transfer.FileName,
                peer,
                DisplayFlowStatus(transfer.Status),
                DisplayDeliveryStatus(transfer.DeliveryStatus),
                DisplayServerFileStatus(transfer.ServerFileStatus),
                FormatSize(transfer.Size),
                transfer.RetainOnServer ? "是" : "否");
            _transferGrid.Rows[index].Tag = transfer;
        }
    }

    private IEnumerable<TransferDto> GetNewReadyInboxTransfers(IEnumerable<TransferDto> transfers)
    {
        if (!_initialRefreshCompleted)
        {
            _initialRefreshCompleted = true;
            return [];
        }

        return transfers
            .Where(IsReadyInboxTransfer)
            .Where(transfer => !_knownReadyInboxTransferIds.Contains(transfer.Id))
            .ToList();
    }

    private void RememberReadyInboxTransfers(IEnumerable<TransferDto> transfers)
    {
        _knownReadyInboxTransferIds.Clear();
        foreach (var transfer in transfers.Where(IsReadyInboxTransfer))
        {
            _knownReadyInboxTransferIds.Add(transfer.Id);
        }
    }

    private bool IsReadyInboxTransfer(TransferDto transfer)
    {
        if (!string.Equals(transfer.ReceiverId, _config.ClientId, StringComparison.Ordinal))
        {
            return false;
        }

        if (transfer.Status is not ("approved" or "ready_to_deliver"))
        {
            return false;
        }

        if (string.Equals(transfer.DeliveryStatus, "delivered", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (string.Equals(transfer.ServerFileStatus, "purged", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return transfer.Controls?.Receiver?.AllowReceive != false;
    }

    private void NotifyNewReadyTransfers(IReadOnlyList<TransferDto> transfers)
    {
        if (transfers.Count == 0)
        {
            return;
        }

        var first = transfers[0];
        SelectTransfer(first.Id);
        RestoreWindow();
        System.Media.SystemSounds.Exclamation.Play();

        var title = transfers.Count == 1 ? "收到新文件" : $"收到 {transfers.Count} 个新文件";
        var message = transfers.Count == 1
            ? $"{first.FileName} 已可接收"
            : $"{first.FileName} 等文件已可接收";
        _notifyIcon.ShowBalloonTip(6000, title, message, ToolTipIcon.Info);
        Log(title + "：" + message);
    }

    private void SelectTransfer(string transferId)
    {
        foreach (DataGridViewRow row in _transferGrid.Rows)
        {
            if (row.Tag is not TransferDto transfer || !string.Equals(transfer.Id, transferId, StringComparison.Ordinal))
            {
                continue;
            }

            _transferGrid.ClearSelection();
            row.Selected = true;
            _transferGrid.CurrentCell = row.Cells[0];
            if (row.Index >= 0)
            {
                _transferGrid.FirstDisplayedScrollingRowIndex = row.Index;
            }
            return;
        }
    }

    private void RestoreWindow()
    {
        if (WindowState == FormWindowState.Minimized)
        {
            WindowState = FormWindowState.Normal;
        }

        Show();
        Activate();
        BringToFront();
    }

    private async Task RunUiActionAsync(Func<Task> action)
    {
        try
        {
            await action();
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void RunUiAction(Action action)
    {
        try
        {
            action();
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void SetBusy(bool busy, string? message = null)
    {
        _isBusy = busy;
        UseWaitCursor = busy;
        _registerButton.Enabled = !busy && !_config.HasCredentials;
        _detectButton.Enabled = !busy && !_config.HasCredentials;
        _testButton.Enabled = !busy;
        _resetButton.Enabled = !busy && _bootstrapOptions.MaintenanceMode && _config.HasCredentials;
        _browseFileButton.Enabled = !busy;
        _uploadButton.Enabled = !busy;
        _browseDirButton.Enabled = !busy;
        _refreshButton.Enabled = !busy;
        _receiveButton.Enabled = !busy;

        if (!string.IsNullOrWhiteSpace(message))
        {
            _progressLabel.Text = message;
        }
        else if (!busy && _uploadProgress.Value == 0)
        {
            _progressLabel.Text = "等待操作";
        }

        if (!busy)
        {
            ApplyConfigurationLockState();
        }
    }

    private void SetProgress(int percent, string message)
    {
        _uploadProgress.Value = Math.Max(0, Math.Min(100, percent));
        _progressLabel.Text = message;
    }

    private void Log(string message)
    {
        var line = $"[{DateTime.Now:HH:mm:ss}] {message}";
        if (string.IsNullOrWhiteSpace(_logText.Text))
        {
            _logText.Text = line;
        }
        else
        {
            _logText.AppendText(Environment.NewLine + line);
        }
    }

    private void ShowError(string message)
    {
        Log("错误：" + message);
        MessageBox.Show(this, message, "操作失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    private static string FormatSize(long bytes)
    {
        if (bytes >= 1024L * 1024L * 1024L)
        {
            return $"{bytes / 1024d / 1024d / 1024d:N2} GB";
        }

        if (bytes >= 1024L * 1024L)
        {
            return $"{bytes / 1024d / 1024d:N2} MB";
        }

        if (bytes >= 1024L)
        {
            return $"{bytes / 1024d:N1} KB";
        }

        return $"{bytes} B";
    }

    private static string DisplayFlowStatus(string status)
    {
        return status switch
        {
            "uploading" => "上传中",
            "assembling" => "合并中",
            "pending_approval" => "等待中转确认",
            "approved" or "ready_to_deliver" => "等待接收",
            "delivered" => "已接收",
            "rejected" => "已驳回",
            _ => string.IsNullOrWhiteSpace(status) ? "-" : status
        };
    }

    private static string DisplayDeliveryStatus(string status)
    {
        return status switch
        {
            "not_ready" => "未就绪",
            "waiting" => "待接收",
            "receiving" => "接收中",
            "delivered" => "已接收",
            _ => string.IsNullOrWhiteSpace(status) ? "-" : status
        };
    }

    private static string DisplayServerFileStatus(string status)
    {
        return status switch
        {
            "uploading" => "上传中",
            "temporary" => "临时中转",
            "retained" => "已备份",
            "purged" => "已清除",
            "unavailable" => "不可用",
            _ => string.IsNullOrWhiteSpace(status) ? "-" : status
        };
    }

    private static string GetSafeFileName(string fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName))
        {
            return "received-file";
        }

        foreach (var invalid in Path.GetInvalidFileNameChars())
        {
            fileName = fileName.Replace(invalid, '_');
        }

        return string.IsNullOrWhiteSpace(fileName) ? "received-file" : fileName;
    }

    private static string GetUniquePath(string path)
    {
        if (!File.Exists(path))
        {
            return path;
        }

        var directory = Path.GetDirectoryName(path) ?? "";
        var name = Path.GetFileNameWithoutExtension(path);
        var extension = Path.GetExtension(path);

        for (var index = 1; index < 10000; index++)
        {
            var candidate = Path.Combine(directory, $"{name} ({index}){extension}");
            if (!File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new InvalidOperationException("无法生成不重名的保存路径。");
    }
}
