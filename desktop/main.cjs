// Marcaz — aplicativo para Windows (Electron).
// O app continua sendo o mesmo de sempre, servido na nuvem; esta janela é um
// casca nativa que abre o painel do gestor, guarda a sessão no perfil do usuário
// e oferece ícone na área de trabalho e no menu Iniciar.
const { app, BrowserWindow, Menu, shell, session, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Endereço do Marcaz. Pode ser trocado com --url=... ou na variável MARCAZ_URL,
// e fica salvo em config.json para o cliente não precisar digitar nada.
const ARQUIVO_CONFIG = path.join(app.getPath('userData'), 'config.json');
const PADRAO = 'https://marcaz-saas-qjpm.vercel.app/gestor';

function lerConfig() {
  let c = null;
  try {
    c = JSON.parse(fs.readFileSync(ARQUIVO_CONFIG, 'utf8'));
  } catch {
    return { url: PADRAO, maximizada: false };
  }
  let url = c.url || PADRAO;
  // instalações antigas salvaram a raiz do site; o app deve abrir no painel
  if (/^https?:\/\/[^/]+\/?$/.test(url)) url = url.replace(/\/+$/, '') + '/gestor';
  return { url, maximizada: !!c.maximizada };
}

function salvarConfig(c) {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO_CONFIG), { recursive: true });
    fs.writeFileSync(ARQUIVO_CONFIG, JSON.stringify(c, null, 2));
  } catch { /* sem permissão de escrita: segue com o padrão */ }
}

function urlDaLinhaDeComando() {
  const arg = process.argv.find((a) => a.startsWith('--url='));
  return arg ? arg.slice(6) : (process.env.MARCAZ_URL || null);
}

let config = lerConfig();
let janela = null;

function criarJanela() {
  janela = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Marcaz',
    autoHideMenuBar: true,
    backgroundColor: '#0b0d12',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  if (config.maximizada) janela.maximize();

  janela.loadURL(config.url);

  janela.once('ready-to-show', () => janela.show());

  // links externos (WhatsApp, Instagram, PDF) abrem no navegador padrão
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (e, url) => {
    const mesmoHost = (() => {
      try {
        return new URL(url).host === new URL(config.url).host;
      } catch {
        return false;
      }
    })();
    if (!mesmoHost) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // sem console de desenvolvedor para o cliente (só com MARCAZ_DEV=1)
  if (process.env.MARCAZ_DEV !== '1') {
    janela.webContents.on('devtools-opened', () => janela.webContents.closeDevTools());
  }

  janela.on('close', () => {
    config.maximizada = janela.isMaximized();
    salvarConfig(config);
  });
  janela.on('closed', () => { janela = null; });
}

function menuProprio() {
  const template = [
    {
      label: 'Marcaz',
      submenu: [
        {
          label: 'Recarregar',
          accelerator: 'CmdOrCtrl+R',
          click: () => janela && janela.reload(),
        },
        {
          label: 'Endereço do servidor',
          submenu: [
            { label: PADRAO, click: () => trocarUrl(PADRAO) },
            { label: 'Desenvolvimento (localhost:3000)', click: () => trocarUrl('http://localhost:3000') },
          ],
        },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    { role: 'editMenu', label: 'Editar' },
    { role: 'viewMenu', label: 'Exibir' },
    {
      label: 'Janela',
      submenu: [{ role: 'togglefullscreen' }, { role: 'minimize' }, { role: 'zoom' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function trocarUrl(url) {
  config.url = url;
  salvarConfig(config);
  if (janela) janela.loadURL(url);
}

// uma janela por computador
const instancia = app.requestSingleInstanceLock();
if (!instancia) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (janela) {
      if (janela.isMinimized()) janela.restore();
      janela.focus();
    }
  });

  app.whenReady().then(async () => {
    const daLinha = urlDaLinhaDeComando();
    if (daLinha) { config.url = daLinha; salvarConfig(config); }

    app.setName('Marcaz');
    menuProprio();

    // cookie de sessão expira em 7 dias no servidor; aqui não derrubamos nunca
    try {
      await session.defaultSession.cookies.set({
        url: config.url,
        name: 'marcaz_app',
        value: '1',
        expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
      });
    } catch { /* irrelevante se falhar */ }

    criarJanela();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) criarJanela();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
