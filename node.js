const net = require('net');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Para gerar IDs únicos

class Node {
  constructor(deviceId, nodeIds, serverHost = 'localhost', serverPort = 8005) {
    this.deviceId = parseInt(deviceId);
    this.nodeIds = nodeIds.split(',').map(Number);
    this.hostname = os.hostname();
    this.IPAddr = '127.0.0.1'; // Altere conforme necessário

    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.serverAddress = { host: this.serverHost, port: this.serverPort };

    this.nodeElectionId = 4;
    this.nodeElectionHost = `node-${this.nodeElectionId}`;
    this.nodeElectionPort = 80;
    this.nodeElectionAddress = { host: this.nodeElectionHost, port: this.nodeElectionPort };
    this.nodeAddress = { host: `node-${this.deviceId}`, port: this.nodeElectionPort };
    this.isElected = false;

    this.electionsStarted = false;
    this.actualElectionSendingNode = -1;

    this.messageQueue = [];

    this.setElectedNode();
  }

  setElectedNode() {
    if (this.nodeElectionId === this.deviceId) {
      this.isElected = true;
    }
    this.nodeElectionHost = `node-${this.nodeElectionId}`;
  }

  promoteNode(leader) {
    console.log('Promoting leader');
    this.nodeElectionId = leader;
    this.nodeElectionHost = `node-${this.nodeElectionId}`;
    if (this.nodeElectionId === this.deviceId) {
      this.isElected = true;
    }
  }

  processQueue() {
    while (this.messageQueue.length > 0) {
      const data = this.messageQueue.shift();
      this.sendMessage(data);
    }
  }

  electNewLeader() {
    console.log('Election in progress...');
    this.electionsStarted = true;
    this.actualElectionSendingNode = this.nodeIds[0];
    this.nodeIds.shift();
    const customAddr = { host: `node-${this.nodeIds[0]}`, port: this.nodeElectionPort };
    const message = `<ELECTION>${this.deviceId}`;
    console.log(`Send election message: ${message} to ${customAddr.host}:${customAddr.port}`);
    this.sendMessage(message, customAddr);
  }

  doElection(message) {
    console.log('Election ongoing...');
    const votingList = message.split(',').map(Number);
    console.log(`${this.nodeElectionId} not in ${votingList}: ${!votingList.includes(this.nodeElectionId)}`);
    if (!votingList.includes(this.nodeElectionId)) {
      const missingNodes = this.nodeIds.filter(node => !votingList.includes(node));
      const nextNode = missingNodes[0];
      this.actualElectionSendingNode = nextNode;
      const sendingMessage = `<ELECTION>${message},${this.deviceId}`;
      const customAddr = { host: `node-${nextNode}`, port: this.nodeElectionPort };
      console.log(`Sending ${sendingMessage} to ${customAddr.host}:${customAddr.port}`);
      this.sendMessage(sendingMessage, customAddr);
    } else {
      console.log('Setting a Leader');
      const leader = Math.max(...votingList);
      const broadcastList = votingList.filter(node => node !== this.deviceId);

      for (const node of broadcastList) {
        const message = `<LEADER>${leader}`;
        const customAddr = { host: `node-${node}`, port: this.nodeElectionPort };
        console.log(`Sending ${message} to ${customAddr.host}:${customAddr.port}`);
        this.sendMessage(message, customAddr);
      }
    }
  }

  dataFormat(data) {
    const messageSplited = data.split('>');
    return { type: messageSplited[0].replace('<', '').replace('>', '').trim(), content: messageSplited[1].trim() };
  }

  initNodeServer() {
    const dataPayload = 2048;
    const server = net.createServer();

    server.on('listening', () => {
      console.log(`Starting up echo server on ${this.nodeAddress.host}:${this.nodeAddress.port}`);
    });

    server.on('connection', (client) => {
      console.log('Waiting to receive message from client');

      client.on('data', (data) => {
        const decodedMessage = data.toString('utf-8');
        const { type, content } = this.dataFormat(decodedMessage);
        console.log(`${type} - ${content}`);

        if (data && this.isElected && type === 'SAVE') {
          this.messageQueue.push(content);
        }

        if (data && type === 'ELECTION') {
          this.electionsStarted = true;
          if (!content.split(',').map(Number).includes(this.deviceId)) {
            this.doElection(content);
            setTimeout(() => {
              this.electNewLeader();
            }, 5000);
          }
        }

        if (data && type === 'LEADER' && this.electionsStarted) {
          if (!content.includes(this.deviceId.toString())) {
            this.doElection(content);
            this.electionsStarted = false;
            setTimeout(() => {
              this.electNewLeader();
            }, 5000);
          }
        }

        client.write(data);
        client.end();
      });

      client.on('end', () => {
        console.log('Client disconnected');
      });

      client.on('error', (err) => {
        console.error(err.stack);
      });
    });

    server.on('error', (err) => {
      console.error(`Server error: ${err.message}`);
    });

    server.listen(this.nodeAddress.port, this.IPAddr);
  }

  sendMessage(message, customAddr) {
    console.log('Starting send message process');
    const client = new net.Socket();

    client.on('error', (err) => {
      console.error(`Error: ${err.message}`);
      if (!this.electionsStarted) {
        this.electNewLeader();
      }
      client.destroy();
    });

    client.connect(customAddr || this.serverAddress, () => {
      console.log(`Sending ${message}`);
      client.write(message);
      client.end();
    });
  }

  messageSpam() {
    if (!this.isElected && !this.electionsStarted) {
      const message = `<SAVE>device_id = ${this.deviceId} | hostname = ${this.hostname} | ip = ${this.IPAddr} | timestamp = ${new Date()}`;
      for (let i = 0; i < 100; i++) {
        if (this.nodeElectionId === this.deviceId) {
          this.sendMessage(message);
        }
        setTimeout(() => {
          const randomNode = this.nodeIds[Math.floor(Math.random() * this.nodeIds.length)];
          this.sendMessage(message, { host: `node-${randomNode}`, port: this.nodeElectionPort });
        }, Math.floor(Math.random() * 4000) + 1000);
      }
    }
  }
}

const deviceId = process.argv[2];
const nodeIds = process.argv[3];
const nodeInstance = new Node(deviceId, nodeIds);
nodeInstance.initNodeServer();

setInterval(() => {
  console.log('Starting processing thread');
  nodeInstance.processQueue();
}, 1000);

setInterval(() => {
  console.log('Starting message spam thread');
  nodeInstance.messageSpam();
}, 10000);
