const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const kurento = require('kurento-client');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["my-custom-header"],
        credentials: true
    },
    allowEIO3: true
});

const kurentoUri = 'ws://localhost:8888/kurento';
let kurentoClient = null;

function getKurentoClient(callback) {
    if (kurentoClient !== null) return callback(null, kurentoClient);
    kurento(kurentoUri, function (error, client) {
        if (error) {
            console.error("Could not connect to Kurento Media Server", error);
            return callback(error);
        }
        kurentoClient = client;
        callback(null, kurentoClient);
    });
}

let sessions = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('start', (broadcastId, sdpOffer) => {
        console.log(`Broadcast ${broadcastId} started by ${socket.id}`);
        startBroadcast(broadcastId, sdpOffer, socket);
    });

    socket.on('join', (broadcastId, sdpOffer) => {
        console.log(`User ${socket.id} joined broadcast ${broadcastId}`);
        joinBroadcast(broadcastId, sdpOffer, socket);
    });

    socket.on('iceCandidate', (broadcastId, candidate) => {
        console.log(`ICE candidate from ${socket.id} for broadcast ${broadcastId}`);
        onIceCandidate(broadcastId, candidate);
    });

    socket.on('disconnect_request', (broadcastId) => {
        console.log(`User ${socket.id} disconnected from broadcast ${broadcastId}`);
        stopBroadcast(broadcastId, socket);
    });

    socket.on('disconnect', () => {
        console.log(`User ${socket.id} disconnected.`);
        Object.keys(sessions).forEach(broadcastId => {
            const session = sessions[broadcastId];
            if (session.broadcaster === socket.id) {
                stopBroadcast(broadcastId, socket);
            } else {
                session.viewers = session.viewers.filter(id => id !== socket.id);
            }
        });
    });
});

function startBroadcast(broadcastId, sdpOffer, socket) {
    getKurentoClient((error, kurentoClient) => {
        if (error) {
            return socket.emit('error', 'Media server error');
        }

        kurentoClient.create('MediaPipeline', (error, pipeline) => {
            if (error) {
                return socket.emit('error', 'Media pipeline error');
            }

            pipeline.create('WebRtcEndpoint', (error, webRtcEndpoint) => {
                if (error) {
                    pipeline.release();
                    return socket.emit('error', 'WebRtcEndpoint creation error');
                }

                sessions[broadcastId] = {
                    'pipeline': pipeline,
                    'webRtcEndpoint': webRtcEndpoint,
                    'broadcaster': socket.id,
                    'viewers': []
                };

                socket.broadcastId = broadcastId;

                webRtcEndpoint.processOffer(sdpOffer, (error, sdpAnswer) => {
                    if (error) {
                        stopBroadcast(broadcastId, socket);
                        return socket.emit('error', 'Error processing offer');
                    }

                    socket.emit('startResponse', { sdpAnswer });
                });

                webRtcEndpoint.on('OnIceCandidate', event => {
                    const candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                    socket.emit('iceCandidate', { candidate });
                });

                webRtcEndpoint.gatherCandidates(error => {
                    if (error) {
                        stopBroadcast(broadcastId, socket);
                        return socket.emit('error', 'Error gathering candidates');
                    }
                });

                console.log(`Broadcast ${broadcastId} started`);
            });
        });
    });
}

function joinBroadcast(broadcastId, sdpOffer, socket) {
    const session = sessions[broadcastId];
    if (!session) {
        return socket.emit('error', 'Broadcast not found');
    }

    session.pipeline.create('WebRtcEndpoint', (error, webRtcEndpoint) => {
        if (error) {
            return socket.emit('error', 'WebRtcEndpoint creation error');
        }

        session.viewers.push(socket.id);
        socket.broadcastId = broadcastId;

        webRtcEndpoint.processOffer(sdpOffer, (error, sdpAnswer) => {
            if (error) {
                return socket.emit('error', 'Error processing offer');
            }

            socket.emit('joinResponse', { sdpAnswer });

            webRtcEndpoint.on('OnIceCandidate', event => {
                const candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                socket.emit('iceCandidate', { candidate });
            });

            webRtcEndpoint.gatherCandidates(error => {
                if (error) {
                    return socket.emit('error', 'Error gathering candidates');
                }
            });

            session.webRtcEndpoint.connect(webRtcEndpoint, error => {
                if (error) {
                    return socket.emit('error', 'Error connecting WebRtcEndpoints');
                }

                console.log(`User ${socket.id} joined broadcast ${broadcastId}`);
            });
        });
    });
}

function stopBroadcast(broadcastId, socket) {
    const session = sessions[broadcastId];
    if (session) {
        session.pipeline.release();
        delete sessions[broadcastId];

        socket.emit('stopResponse', { message: 'Broadcast stopped' });
        console.log(`Broadcast ${broadcastId} stopped`);
    }
}

function onIceCandidate(broadcastId, candidate) {
    const session = sessions[broadcastId];
    if (session) {
        const webRtcEndpoint = session.webRtcEndpoint;
        webRtcEndpoint.addIceCandidate(kurento.getComplexType('IceCandidate')(candidate));
    }
}

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

