import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- CONFIG & CONSTANTS ---
const FIELD_Y = -26;
const YARD_TO_UNIT = 1;
const TEAM_COLORS = {
    HOME: { primary: 0x002244, secondary: 0xc60c30 }, // Patriots-ish
    AWAY: { primary: 0xe31837, secondary: 0xffb612 }  // Chiefs-ish
};

const PLAYS = [
    { name: 'Four Verts', type: 'pass', routes: [
        { id: 1, label: 'WR1', pos: [-20, 0], waypoints: [[0, 5], [0, 60]] },
        { id: 2, label: 'WR2', pos: [20, 0], waypoints: [[0, 5], [0, 60]] },
        { id: 3, label: 'TE', pos: [8, 0], waypoints: [[0, 5], [5, 40]] }
    ]},
    { name: 'Quick Slants', type: 'pass', routes: [
        { id: 1, label: 'WR1', pos: [-20, 0], waypoints: [[0, 5], [15, 20]] },
        { id: 2, label: 'WR2', pos: [20, 0], waypoints: [[0, 5], [-15, 20]] },
        { id: 3, label: 'TE', pos: [8, 0], waypoints: [[0, 5], [-5, 15]] }
    ]}
];

// --- GAME STATE ---
let scene, camera, renderer, clock;
let football, players = [], receivers = [];
let gameState = 'LOADING';
let currentPlay = null;
let ballCarrier = null;
let yardLine = 20; // 0 to 100
let score = { home: 0, away: 0 };

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(50, 100, 50);
    sun.castShadow = true;
    sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    createField();
    createFootball();
    loadStadium();

    clock = new THREE.Clock();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', onWindowResize);
    
    animate();
}

function createField() {
    // Texture creation
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#4c9a2a';
    ctx.fillRect(0, 0, 512, 1024);
    
    // Grid Lines
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 4;
    for(let i=0; i<=120; i+=10) {
        const y = (i/120) * 1024;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(53.3, 120);
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const field = new THREE.Mesh(geometry, material);
    field.rotation.x = -Math.PI / 2;
    field.position.y = FIELD_Y;
    field.receiveShadow = true;
    scene.add(field);
}

function createFootball() {
    const geo = new THREE.SphereGeometry(0.3, 16, 16);
    geo.scale(1.4, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    football = new THREE.Mesh(geo, mat);
    football.castShadow = true;
    scene.add(football);
}

function loadStadium() {
    const loader = new GLTFLoader();
    loader.load('/tangier_stadium.glb', (gltf) => {
        scene.add(gltf.scene);
    }, undefined, (e) => console.warn("Stadium file not found at /public/tangier_stadium.glb"));
}

function createPlayer(isHome, x, z, role = 'WR') {
    const color = isHome ? TEAM_COLORS.HOME : TEAM_COLORS.AWAY;
    const group = new THREE.Group();
    
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 1.5), new THREE.MeshStandardMaterial({color: color.primary}));
    torso.castShadow = true;
    group.add(torso);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.45), new THREE.MeshStandardMaterial({color: color.secondary}));
    helmet.position.y = 1;
    group.add(helmet);

    group.position.set(x, FIELD_Y + 0.75, z);
    scene.add(group);
    
    return { mesh: group, role, routeProgress: 0, currentWaypoint: 0 };
}

window.startGame = () => {
    document.getElementById('menu-start').classList.add('hidden');
    showPlayCalling();
};

function showPlayCalling() {
    gameState = 'PLAY_CALL';
    const list = document.getElementById('play-list');
    list.innerHTML = '';
    PLAYS.forEach(play => {
        const div = document.createElement('div');
        div.className = 'play-card';
        div.innerHTML = `<h3>${play.name}</h3><p>${play.type.toUpperCase()}</p>`;
        div.onclick = () => selectPlay(play);
        list.appendChild(div);
    });
    document.getElementById('play-calling').style.display = 'flex';
}

function selectPlay(play) {
    currentPlay = play;
    document.getElementById('play-calling').style.display = 'none';
    setupFormation();
    gameState = 'PRE_SNAP';
    document.getElementById('snap-hint').classList.remove('hidden');
}

function setupFormation() {
    players.forEach(p => scene.remove(p.mesh));
    players = [];
    receivers = [];

    const zPos = (yardLine - 60); // Mapping yardline to Z

    // QB
    const qb = createPlayer(true, 0, zPos + 7, 'QB');
    players.push(qb);
    ballCarrier = qb;

    // Receivers
    currentPlay.routes.forEach(r => {
        const p = createPlayer(true, r.pos[0], zPos + r.pos[1], 'WR');
        p.routeData = r;
        players.push(p);
        receivers.push(p);
    });

    updateBallPosition();
}

function handleKeyDown(e) {
    if (gameState === 'PRE_SNAP' && e.code === 'Space') snapBall();
    if (gameState === 'PLAYING' && ballCarrier.role === 'QB') {
        if (e.key === '1') throwTo(0);
        if (e.key === '2') throwTo(1);
        if (e.key === '3') throwTo(2);
    }
}

function snapBall() {
    gameState = 'PLAYING';
    document.getElementById('snap-hint').classList.add('hidden');
    document.getElementById('pass-hints').classList.remove('hidden');
}

function throwTo(index) {
    const target = receivers[index];
    if (!target) return;

    gameState = 'IN_FLIGHT';
    document.getElementById('pass-hints').classList.add('hidden');

    const start = football.position.clone();
    // Lead the receiver: target where they will be in 1 second
    const end = target.mesh.position.clone().add(new THREE.Vector3(0, 0, -10)); 
    
    let t = 0;
    const duration = 1.0;
    
    const ballInterval = setInterval(() => {
        t += 0.02;
        const progress = t / duration;
        
        football.position.lerpVectors(start, end, progress);
        football.position.y = FIELD_Y + Math.sin(progress * Math.PI) * 10 + 1; // Arc

        if (progress >= 1) {
            clearInterval(ballInterval);
            catchBall(target);
        }
    }, 20);
}

function catchBall(player) {
    ballCarrier = player;
    gameState = 'PLAYING';
    document.getElementById('big-message').innerText = "CAUGHT!";
    setTimeout(() => document.getElementById('big-message').innerText = "", 1000);
}

function updateBallPosition() {
    if (ballCarrier) {
        football.position.copy(ballCarrier.mesh.position);
        football.position.y += 0.5;
    }
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (gameState === 'PLAYING') {
        // Simple Route Running
        receivers.forEach(r => {
            r.mesh.position.z -= 8 * delta; // move downfield
        });

        // QB Scramble (Basic)
        // Add WASD logic here to move ballCarrier.mesh.position
        
        updateBallPosition();

        // Check Touchdown
        if (football.position.z < -50) {
            score.home += 6;
            document.getElementById('home-score').innerText = score.home;
            document.getElementById('big-message').innerText = "TOUCHDOWN!";
            gameState = 'CELEBRATING';
            setTimeout(() => { yardLine = 20; showPlayCalling(); document.getElementById('big-message').innerText = ""; }, 3000);
        }
    }

    // Camera - Broadcast Style
    const camTarget = football.position.clone();
    camera.position.lerp(new THREE.Vector3(camTarget.x * 0.5, FIELD_Y + 25, camTarget.z + 35), 0.05);
    camera.lookAt(camTarget.x, FIELD_Y, camTarget.z - 10);

    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

init();
