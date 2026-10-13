const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jcSatube', {
  pesquisar: termo => ipcRenderer.invoke('pesquisar-videos', termo),
  abrirVideo: url => ipcRenderer.invoke('abrir-video', url),
  escolherPasta: () => ipcRenderer.invoke('escolher-pasta'),
  abrirPastaDestino: pasta => ipcRenderer.invoke('abrir-pasta-destino', pasta),
  baixar: dados => ipcRenderer.invoke('baixar', dados),
  progressoDownload: callback => {
    ipcRenderer.removeAllListeners('download-progresso');
    ipcRenderer.on('download-progresso', (_event, dados) => callback(dados));
  }
});
