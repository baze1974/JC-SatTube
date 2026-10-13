const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { execFile, spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3180;

const BASE = __dirname;

function getYtDlpPath() {
  if (process.platform === 'win32') {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'bin', 'yt-dlp.exe')
      : path.join(BASE, 'bin', 'windows', 'yt-dlp.exe');
  }
  return '/usr/local/bin/yt-dlp';
}

function getFfmpegPath() {
  if (process.platform === 'win32') {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'bin', 'ffmpeg.exe')
      : path.join(BASE, 'bin', 'windows', 'ffmpeg.exe');
  }
  return '/usr/bin/ffmpeg';
}

function iniciarServidor() {
  const tipos = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8'
  };

  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const nome = pathname === '/' ? 'index.html' : pathname.slice(1);
    const arquivo = path.resolve(BASE, nome);

    if (!arquivo.startsWith(BASE + path.sep) && arquivo !== path.join(BASE, 'index.html')) {
      res.writeHead(403);
      return res.end('Acesso negado');
    }

    fs.readFile(arquivo, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Arquivo não encontrado');
      }
      res.writeHead(200, {
        'Content-Type': tipos[path.extname(arquivo)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function criarJanela() {
  const janela = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 850,
    minHeight: 550,
    title: 'JC-SATube Rubro-Negro',
    backgroundColor: '#101010',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(BASE, 'preload.js')
    }
  });
  janela.loadURL(`http://127.0.0.1:${PORT}/`);
}

ipcMain.handle('pesquisar-videos', async (_event, termo) => {
  if (typeof termo !== 'string' || !termo.trim()) return [];
  return new Promise((resolve, reject) => {
    execFile(getYtDlpPath(),
      ['--flat-playlist', '--dump-single-json', `ytsearch10:${termo.trim()}`],
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
      (erro, stdout) => {
        if (erro) return reject(new Error('A pesquisa falhou. Verifique a conexão e tente novamente.'));
        try {
          const dados = JSON.parse(stdout);
          resolve((dados.entries || []).map(v => ({
            id: v.id,
            title: v.title || 'Vídeo sem título',
            channel: v.channel || v.uploader || 'Canal do YouTube',
            duration: v.duration || 0,
            thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            url: `https://www.youtube.com/watch?v=${v.id}`
          })));
        } catch {
          reject(new Error('Não foi possível interpretar os resultados.'));
        }
      });
  });
});


ipcMain.handle('escolher-pasta', async () => {
  const resultado = await dialog.showOpenDialog({
    title: 'Escolher pasta dos downloads',
    properties: ['openDirectory', 'createDirectory']
  });
  return resultado.canceled ? null : resultado.filePaths[0];
});

let downloadAtivo = false;


ipcMain.handle('abrir-pasta-destino', async (_event, pasta) => {
  if (typeof pasta !== 'string' || !path.isAbsolute(pasta) ||
      !fs.existsSync(pasta) || !fs.statSync(pasta).isDirectory()) {
    throw new Error('Escolha uma pasta de destino válida primeiro.');
  }
  const erro = await shell.openPath(pasta);
  if (erro) throw new Error(erro);
  return true;
});

ipcMain.handle('baixar', async (event, dados) => {
  if (downloadAtivo) throw new Error('Aguarde o download atual terminar.');
  if (!dados || typeof dados.url !== 'string') throw new Error('Informe um link válido.');

  let endereco;
  try {
    endereco = new URL(dados.url);
  } catch {
    throw new Error('O link informado não é válido.');
  }

  const hosts = [
    'youtube.com', 'www.youtube.com', 'm.youtube.com',
    'music.youtube.com', 'youtu.be', 'youtube-nocookie.com',
    'www.youtube-nocookie.com'
  ];
  if (!hosts.includes(endereco.hostname)) {
    throw new Error('Use um link válido do YouTube.');
  }

  const pasta = dados.pasta;
  if (typeof pasta !== 'string' || !path.isAbsolute(pasta) ||
      !fs.existsSync(pasta) || !fs.statSync(pasta).isDirectory()) {
    throw new Error('Escolha uma pasta de destino válida.');
  }

  const audio = dados.tipo === 'audio';
  const args = [
    '--newline', '--no-color', '--progress', '--progress-delta', '0.5',
    '-o', path.join(pasta, '%(title).180B.%(ext)s')
  ];

  if (audio) {
    args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    const formatos = {
      best: 'bestvideo*+bestaudio/best',
      '1080': 'bestvideo*[height<=1080]+bestaudio/best[height<=1080]',
      '720': 'bestvideo*[height<=720]+bestaudio/best[height<=720]',
      '480': 'bestvideo*[height<=480]+bestaudio/best[height<=480]'
    };
    args.push('-f', formatos[String(dados.qualidade)] || formatos.best,
              '--merge-output-format', 'mp4');
  }
  args.push('--', endereco.href);

  const binario = getYtDlpPath();
  const ffmpeg = getFfmpegPath();

  if (!fs.existsSync(binario)) {
    throw new Error('Não encontrei o executável yt-dlp: ' + binario);
  }
  if (audio && !fs.existsSync(ffmpeg)) {
    throw new Error('Não encontrei o FFmpeg necessário para gerar MP3: ' + ffmpeg);
  }

  downloadAtivo = true;
  const enviar = dados => {
    if (!event.sender.isDestroyed()) event.sender.send('download-progresso', dados);
  };
  enviar({ ativo: true, percentual: 0, mensagem: 'Iniciando download...' });

  const proc = spawn(binario, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let buffer = '';
  let encerrado = false;

  const terminar = (codigo, erro = '') => {
    if (encerrado) return;
    encerrado = true;
    downloadAtivo = false;
    if (erro) {
      enviar({ ativo: false, concluido: false, mensagem: 'Erro: ' + erro });
    } else if (codigo === 0) {
      enviar({ ativo: false, concluido: true, percentual: 100, mensagem: 'Download concluído!' });
    } else {
      enviar({
        ativo: false, concluido: false,
        mensagem: 'Download não concluído. Confira a conexão, o link e as permissões do vídeo.'
      });
    }
  };

  proc.stderr.on('data', trecho => {
    buffer += trecho.toString();
    const linhas = buffer.split(/[\r\n]+/);
    buffer = /[\r\n]$/.test(buffer) ? '' : (linhas.pop() || '');
    for (const linha of linhas) {
      const match = linha.match(/\[download\]\s+([\d.]+)%/);
      if (match) {
        const velocidade = linha.match(/\bat\s+(.+?)\s+ETA\b/);
        const eta = linha.match(/\bETA\s+(\S+)/);
        enviar({
          ativo: true,
          percentual: Math.min(100, Number(match[1])),
          velocidade: velocidade ? velocidade[1] : '',
          eta: eta ? eta[1] : '',
          mensagem: 'Baixando: ' + Number(match[1]).toFixed(1) + '%'
        });
      } else if (/ERROR:/.test(linha)) {
        enviar({ ativo: true, mensagem: linha.replace(/^.*ERROR:\s*/, '').slice(0, 220) });
      }
    }
  });
  proc.on('error', erro => terminar(1, erro.message));
  proc.on('close', codigo => terminar(codigo));
  return { iniciado: true };
});

app.whenReady().then(async () => {
  try {
    await iniciarServidor();
    criarJanela();
  } catch (err) {
    console.error('Não foi possível iniciar o servidor local:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
