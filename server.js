const net = require('net')
const fs = require('fs')
const os = require('os')

const { promisify } = require('util')
const appendFileAsync = promisify(fs.appendFile)

const logging = {
  info: (message) => console.log(`INFO: ${message}`)
}

class Server {
  constructor(serverHost = 'server', serverPort = 80) {
    this.hostname = os.hostname()
    this.IPAddr = (os.networkInterfaces().lo0 && os.networkInterfaces().lo0[0]) ? os.networkInterfaces().lo0[0].address : '127.0.0.1'

    this.serverHost = serverHost
    this.serverPort = serverPort
    this.serverAddress = { host: this.serverHost, port: this.serverPort }

    this.folder = "files"
    this.file = "logs.txt"
    this.path = `${this.folder}/${this.file}`

    this.createFile()
  }

  createFile() {
    if (!fs.existsSync(this.folder)) {
      fs.mkdirSync(this.folder)
    }

    fs.closeSync(fs.openSync(this.path, 'w'))
  }

  async writeOnLogs(data) {
    try {
      await appendFileAsync(this.path, `${data}\n`)
      logging.info('data saved on log file')
    } catch (error) {
      console.error(error)
    }
  }

  initServer() {
    const dataPayload = 2048
    const server = net.createServer()

    server.on('listening', () => {
      logging.info(`Starting up echo server on ${this.IPAddr} port ${this.serverPort}`)
    })

    server.on('connection', (client) => {
      logging.info("Waiting to receive message from client")
      client.on('data', async (data) => {
        try {
          await this.writeOnLogs(data.toString('utf-8'))
          client.write(data)
        } catch (error) {
          console.error(error)
        }
      })

      client.on('error', (error) => {
        console.error(error)
      })

      client.on('end', () => {
        client.end()
      })
    })

    server.on('error', (error) => {
      console.error(error)
    })

    server.listen(this.serverPort)
  }
}

const server = new Server()
server.initServer()
