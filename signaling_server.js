const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
// const io = new Server(server);
const io = require('socket.io')(server, {
  cors: {
    origin: "*",  // 모든 도메인에서의 접근을 허용
    methods: ["GET", "POST"],  // 허용되는 메소드
    allowedHeaders: ["my-custom-header"],  // 허용되는 헤더
    credentials: true
  },
  allowEIO3: true
});

// 세션 저장소
const sessions = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 방송 시작
    socket.on('start', (broadcastId, offerSdp) => {
	// 방송자 session 저장
        if (!sessions[broadcastId]) {
            sessions[broadcastId] = {
                broadcaster: socket.id,
                viewers: [],
		offer: offerSdp,
                broadcastId: broadcastId
            };
            console.log(`Broadcast ${broadcastId} started by ${socket.id}`);
        }
    });

    // 시청 시작
    socket.on('join', (broadcastId) => {
        const session = sessions[broadcastId];
        if (session) {
	    // sessoin이 있다면 시청자 목록에 추가
            session.viewers.push(socket.id);

	    // 방송자와 연결
            socket.join(broadcastId);

	    // 저장된 방송자의 offer 를 시청자에게 전달
            socket.emit('offer', session.offer);

	    console.log(`User ${socket.id} joined broadcast ${broadcastId}`);
	} else {
	    // session이 없다면 return error
	    console.log(`Stream ${broadcastId} not found.`);
            socket.emit('error', 'Stream not found');
        }
    });

    // 시청자가 방송자의 offer를 토대로 생성한 answerSdp 전달
    socket.on('answer', (broadcastId, answerSdp) => {
        const session = sessions[broadcastId];
        if (session) {
            // 방송자에게 시청자의 answer 전달
            io.to(session.broadcaster).emit('answer', answerSdp);
            console.log(`Answer from ${socket.id} for broadcast ${broadcastId} sent to broadcaster.`);
        }
    });

    socket.on('iceCandidate', (broadcastId, candidate) => {
        console.log(`ICE candidate from ${socket.id} for broadcast ${broadcastId}`);
        socket.to(broadcastId).emit('iceCandidate', candidate);
    });

    socket.on('disconnect_request', () => {
        console.log(`User ${socket.id} disconnected.`);
        Object.keys(sessions).forEach(broadcastId => {
            const session = sessions[broadcastId];
            if (session.broadcaster === socket.id) {
                // 방송자가 연결을 끊음
                delete sessions[broadcastId];
                io.to(broadcastId).emit('broadcastEnded');
                console.log(`Broadcast ${broadcastId} ended.`);
            } else {
                // 시청자가 연결을 끊음
                session.viewers = session.viewers.filter(id => id !== socket.id);
            }
	    socket.leave(broadcastId)
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

