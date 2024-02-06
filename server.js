// Utilizado para criar um servidor TCP que escuta as conexões de clientes.
const net = require('net')
// Utilizado para criar, ler, escrever e manipular arquivos no sistema de arquivos.
const fs = require('fs')
// Utilizado para obter o nome do host do sistema.
const os = require('os')
// É utilizado para construir caminhos de arquivos
const path = require('path')

// Configurações do servidor
const serverHost = 'localhost'
const serverPort = 8005

class Server {
  constructor() {
    // Obter informações do sistema
    this.hostname = os.hostname()
    this.IPAddr = '127.0.0.1' // Altere conforme necessário

    // Configurações do servidor
    this.serverHost = serverHost
    this.serverPort = serverPort
    this.serverAddress = { host: this.serverHost, port: this.serverPort }

    // Configurações do arquivo de log
    this.folder = 'files'
    this.file = 'logs.txt'
    this.path = path.join(this.folder, this.file)

    // Criar o arquivo de log se não existir
    this.createFile()
  }

  createFile() {
    if (!fs.existsSync(this.folder)) {
      fs.mkdirSync(this.folder)
    }

    if (!fs.existsSync(this.path)) {
      fs.writeFileSync(this.path, '')
    }
  }

  _writeOnLogs(data) {
    // Adicionar dados ao arquivo de log
    const decodedData = data.toString('utf-8');
    fs.appendFileSync(this.path, `${decodedData}\n`);
    console.log('Data saved on log file');
  }

  initServer() {
    const dataPayload = 2048
    const server = net.createServer()

    // Evento de 'listening' - ocorre quando o servidor começa a escutar
    server.on('listening', () => {
      console.log(`Server is listening on ${this.IPAddr}:${this.serverPort}`)
    })

    // Evento de 'connection' - ocorre quando um cliente se conecta
    server.on('connection', (socket) => {
      console.log('Client connected')

      // Evento de 'data' - ocorre quando dados são recebidos do cliente
      socket.on('data', (data) => {
        // Escrever dados no arquivo de log e enviá-los de volta ao cliente
        this.writeOnLogs(data)
        socket.write(data)
      })

      // Evento de 'end' - ocorre quando a conexão com o cliente é encerrada
      socket.on('end', () => {
        console.log('Client disconnected')
      })

      // Evento de 'error' - ocorre em caso de erro no socket
      socket.on('error', (err) => {
        console.error(`Socket error: ${err.message}`)
      })
    })

    // Evento de 'error' - ocorre em caso de erro no servidor
    server.on('error', (err) => {
      console.error(`Server error: ${err.message}`)
    })

    // Iniciar o servidor e fazê-lo escutar no endereço e porta especificados
    server.listen(this.serverPort, this.IPAddr)
  }
  
  resetRotationTimer() {
    // Limpe o temporizador existente, se houver
    if (rotationTimer) {
      clearTimeout(rotationTimer);
    }

    // Configure um novo temporizador para a rotação
    rotationTimer = setTimeout(() => {
      // Inicie uma nova eleição após o intervalo de rotação
      initiateElection();
    }, rotationInterval);
  }
}

// Criar uma instância do servidor e iniciar
const serverInstance = new Server()
serverInstance.initServer()
