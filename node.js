const net = require('net')
const os = require('os')
const { promisify } = require('util')
const { performance } = require('perf_hooks')
const { Mutex } = require('async-mutex')

const logging = {
  info: (message) => console.log(`INFO: ${message}`),
  debug: (message) => console.log(`DEBUG: ${message}`),
  error: (message) => console.error(`ERROR: ${message}`),
}

class Queue {
  constructor() {
    this.items = []
  }

  enqueue(element) {
    this.items.push(element)
  }

  dequeue() {
    if (this.isEmpty()) {
      return "Underflow"
    }
    return this.items.shift()
  }

  isEmpty() {
    return this.items.length === 0
  }

  front() {
    if (this.isEmpty()) {
      return "No elements in Queue"
    }
    return this.items[0]
  }

  printQueue() {
    let str = ""
    for (let i = 0; i < this.items.length; i++) {
      str += this.items[i] + " "
    }
    return str
  }
}

class Node {
  constructor(serverHost = 'server', serverPort = 80) {
    this.deviceId = parseInt(process.argv[2])
    this.nodeList = process.argv[3].split(",").map(Number)
    this.hostname = os.hostname()
    this.IPAddr = (os.networkInterfaces().lo0 && os.networkInterfaces().lo0[0]) ? os.networkInterfaces().lo0[0].address : '127.0.0.1'
    this.serverHost = serverHost
    this.serverPort = serverPort
    this.messageQuantity = 1000
    this.serverAddress = { host: this.serverHost, port: this.serverPort }
    this.nodeElectionId = 4
    this.nodeElectionHost = `node-${this.nodeElectionId}`
    this.nodeElectionPort = 80
    this.nodeAddress = `node-${this.deviceId}`
    this.nodeElectionAddress = { host: this.nodeElectionHost, port: this.nodeElectionPort }
    this.isElected = false
    this.electionsStarted = false
    this.messageQueue = new Queue()
    this.mutex = new Mutex()
    this.setElectedNode()
  }

  setElectedNode() {
    if (this.nodeElectionId === this.deviceId) {
      this.isElected = true
    }
    this.nodeElectionHost = `node-${this.nodeElectionId}`
  }

  async promoteNode(node) {
    logging.info(`promoting node ${node} to leader`)
    await this.mutex.runExclusive(async () => {
      this.nodeElectionId = node
      if (this.nodeElectionId === this.deviceId) {
        this.isElected = true
      }
      this.nodeElectionHost = `node-${this.nodeElectionId}`
      this.nodeElectionAddress = { host: this.nodeElectionHost, port: this.nodeElectionPort }
      this.electionsStarted = false
    })
    logging.info(`node ${node} has been promoted`)
    logging.info(`node_election_id = ${this.nodeElectionId} | node_election_address = ${this.nodeElectionAddress} | is_elected = ${this.isElected}`)
  }

  async processQueue() {
    while (true) {
      const data = await this.messageQueue.dequeue()
      await this.sendMessage(data)
    }
  }

  async electNewLeader() {
    await this.mutex.runExclusive(async () => {
      if (!this.electionsStarted) {
        logging.info("electing new leader")
        this.electionsStarted = true
        this.isWhoStartedAElection = true
        const nextNode = this.nodeList[0]
        const customAddr = { host: `node-${nextNode}`, port: this.nodeElectionPort }
        const message = `<ELECTION>${this.deviceId},${nextNode}`
        logging.info(`send election message: ${message} to ${customAddr.host}:${customAddr.port}`)
        await this.sendMessage(message, customAddr)
      }
    })
  }

  async doElection(message) {
    logging.info("Ongoing election")
    this.electionsStarted = true
    if (this.nodeElectionId in this.nodeList) {
      this.nodeList.splice(this.nodeList.indexOf(this.nodeElectionId), 1)
    }
    const votingList = message.split(",").map(Number)

    if (!votingList.includes(this.deviceId)) {
      const missingNodes = this.nodeList.filter(node => !votingList.includes(node))
      let nextNode = votingList[0]

      if (missingNodes.length > 0) {
        nextNode = missingNodes[0]
      }

      if (this.deviceId.toString() === message && votingList.filter(id => id === this.deviceId).length > 1) {
        logging.info("Setting a Leader")
        const leader = Math.max(...votingList)
        const customAddr = { host: `node-${leader}`, port: this.nodeElectionPort }
        const newLeaderMessage = `<LEADER>${leader}`
        await this.sendMessage(newLeaderMessage, customAddr)
        logging.info(`node ${leader} knows he is a leader`)
        for (const nodeId of votingList) {
          if (nodeId !== this.deviceId && nodeId !== leader) {
            const customAddr = { host: `node-${nodeId}`, port: this.nodeElectionPort }
            logging.info(`sending ${newLeaderMessage} to ${customAddr.host}:${customAddr.port}`)
            await this.sendMessage(newLeaderMessage, customAddr)
          }
        }
        await this.promoteNode(leader)
      } else {
        if (nextNode !== this.deviceId) {
          const sendingMessage = `<ELECTION>${message},${nextNode}`
          const customAddr = { host: `node-${nextNode}`, port: this.nodeElectionPort }
          logging.info(`sending ${sendingMessage} to ${customAddr.host}:${customAddr.port}`)
          await this.sendMessage(sendingMessage, customAddr)
        }
      }
    }
  }

  async dataFormat(data) {
    const messageSplited = data.split('>')
    return [messageSplited[0].replace('<', '').replace('>', '').replace(' ', ''), messageSplited[1]]
  }

  async initNodeServer() {
    const dataPayload = 2048
    const server = net.createServer()

    server.on('listening', () => {
      logging.info(`Starting up echo server on ${this.nodeAddress}`)
    })

    server.on('connection', async (client) => {
      logging.info("Waiting to receive message from client")
      const data = await this.receiveMessage(client, dataPayload)
      const [messageType, message] = await this.dataFormat(data.toString('utf-8'))
      logging.info(`node-${this.deviceId} recived a message: ${messageType} - ${message}`)

      if (this.isElected && messageType === 'SAVE') {
        await this.messageQueue.enqueue(message)
      }
      if (messageType === 'ELECTION') {
        this.electionsStarted = true
        await this.doElection(message)
      }
      if (messageType === 'LEADER' && this.electionsStarted) {
        await this.promoteNode(parseInt(message))
      }

      client.write(data)
      client.end()
    })

    server.on('error', (error) => {
      logging.error(error)
    })

    server.listen(this.nodeElectionPort)
  }

  async sendMessage(message = '', customAddr = {}) {
    logging.info("starting send message process")
    const t0 = performance.now()
    const sock = new net.Socket()
    try {
      if (this.isElected) {
        await this.connectAndSend(sock, this.serverAddress, message)
      } else if (customAddr.host && customAddr.port) {
        await this.connectAndSend(sock, customAddr, message)
      } else {
        await this.connectAndSend(sock, this.nodeElectionAddress, message)
      }
    } catch (error) {
      logging.error(`Other exception: ${error}`)
    } finally {
      sock.end()
      const t1 = performance.now()
      logging.info(`Closing connection to the server. Time taken: ${t1 - t0} milliseconds.`)
    }
  }

  async connectAndSend(sock, address, message) {
    sock.connect(address.port, address.host, () => {
      logging.info(`Sending ${message}`)
      sock.write(message)
    })
    await new Promise(resolve => sock.on('data', resolve))
  }

  async messageSpam() {
    if (!this.isElected && !this.electionsStarted) {
      for (let i = 0; i < this.messageQuantity; i++) {
        const message = `<SAVE>device_id = ${this.deviceId} | hostname = ${this.hostname} | ip = ${this.IPAddr} | timestamp = ${new Date().toISOString()} | leader = ${this.nodeElectionId}`
        if (this.nodeElectionId && !this.electionsStarted && !this.isElected) {
          await this.sendMessage(message)
        }
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 10 + 1) * 1000))
      }
    }
  }
}

const node = new Node()

logging.info("starting processing thread")
const processingThread = node.processQueue.bind(node)
processingThread()

logging.info("starting server thread")
const serverThread = node.initNodeServer.bind(node)
serverThread()

logging.info("starting message_spam thread")
const messageSpamThread = node.messageSpam.bind(node)
messageSpamThread()
