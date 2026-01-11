import React, { useRef, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import * as THREE from 'three';

// --- PHẦN 1: MA THUẬT HẠT (SHADERS) ---
const MagicParticles = ({ handData }) => {
  const mesh = useRef();
  const count = window.innerWidth < 768 ? 3000 : 8000;

  // Khởi tạo vị trí và hướng ngẫu nhiên cho hạt
  const [positions, randoms] = React.useMemo(() => {
    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 1.2 + Math.random() * 0.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      pos.set([r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi)], i * 3);
      rnd.set([Math.random()-0.5, Math.random()-0.5, Math.random()-0.5], i * 3);
    }
    return [pos, rnd];
  }, []);

  const uniforms = React.useMemo(() => ({
    uTime: { value: 0 },
    uExpansion: { value: 0 },
    uHandPos: { value: new THREE.Vector3(0, 0, 0) },
    uIsTracking: { value: 0 }
  }), []);

  useFrame((state) => {
    uniforms.uTime.value = state.clock.getElapsedTime();
    // Làm mượt chuyển động nổ
    uniforms.uExpansion.value = THREE.MathUtils.lerp(uniforms.uExpansion.value, handData.openAmount, 0.1);
    // Cập nhật vị trí tay để hút hạt
    uniforms.uHandPos.value.lerp(handData.pos, 0.1);
    uniforms.uIsTracking.value = THREE.MathUtils.lerp(uniforms.uIsTracking.value, handData.isTracking ? 1 : 0, 0.1);
  });

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aRandom" count={count} array={randoms} itemSize={3} />
      </bufferGeometry>
      <shaderMaterial
        transparent depthWrite={false} blending={THREE.AdditiveBlending}
        uniforms={uniforms}
        vertexShader={`
          uniform float uTime; uniform float uExpansion;
          uniform vec3 uHandPos; uniform float uIsTracking;
          attribute vec3 aRandom; varying vec3 vColor;
          void main() {
            vec3 pos = position;
            // Hiệu ứng Nổ
            pos += (normalize(pos) + aRandom) * uExpansion * 3.0;
            // Hiệu ứng Hút về phía tay
            if(uIsTracking > 0.1) {
              vec3 dist = uHandPos - pos;
              pos += dist * 0.4 * uIsTracking;
            }
            // Hiệu ứng rung rinh tự nhiên
            pos.x += sin(uTime + pos.y) * 0.1;
            
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = (4.0 + uExpansion * 8.0) * (1.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
            vColor = mix(vec3(0.1, 0.9, 0.5), vec3(1.0, 0.4, 0.1), uExpansion);
          }
        `}
        fragmentShader={`
          varying vec3 vColor;
          void main() {
            float r = distance(gl_PointCoord, vec2(0.5));
            if (r > 0.5) discard;
            gl_FragColor = vec4(vColor * pow(1.0 - r*2.0, 1.5), 1.0);
          }
        `}
      />
    </points>
  );
};

// --- PHẦN 2: NHẬN DIỆN TAY (HAND TRACKING) ---
export default function App() {
  const [handData, setHandData] = useState({ openAmount: 0, pos: new THREE.Vector3(0,0,0), isTracking: false });
  const videoRef = useRef();

  useEffect(() => {
    let handLandmarker;
    let animationFrame;

    const initAI = async () => {
      const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm");
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { 
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", 
          delegate: "GPU" 
        },
        runningMode: "VIDEO", numHands: 1
      });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      if(videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadeddata = predict;
      }
    };

    const predict = () => {
      if (videoRef.current && handLandmarker) {
        const results = handLandmarker.detectForVideo(videoRef.current, performance.now());
        if (results.landmarks?.length > 0) {
          const l = results.landmarks[0];
          // 1. Tính độ xòe tay
          const openFingers = [8, 12, 16, 20].filter(i => l[i].y < l[i-2].y).length;
          // 2. Lấy vị trí lòng bàn tay (điểm số 9) và chuyển sang hệ tọa độ 3D
          const x = (0.5 - l[9].x) * 8; // Đảo ngược x vì video bị lật
          const y = (0.5 - l[9].y) * 6;
          setHandData({ openAmount: openFingers / 4, pos: new THREE.Vector3(x, y, 0), isTracking: true });
        } else {
          setHandData(prev => ({ ...prev, isTracking: false, openAmount: 0 }));
        }
      }
      animationFrame = requestAnimationFrame(predict);
    };

    initAI();
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      {/* Video Preview nhỏ ở góc */}
      <video ref={videoRef} autoPlay playsInline muted style={{ position: 'absolute', bottom: 20, right: 20, width: 100, borderRadius: 10, transform: 'scaleX(-1)', opacity: 0.4, zIndex: 10, border: '1px solid white' }} />
      
      <Canvas camera={{ position: [0, 0, 6] }}>
        <MagicParticles handData={handData} />
      </Canvas>

      <div style={{ position: 'absolute', top: 20, width: '100%', textAlign: 'center', color: '#fff', opacity: 0.5, pointerEvents: 'none', fontFamily: 'sans-serif' }}>
        {handData.isTracking ? "Đã nhận diện tay - Di chuyển để hút hạt, Xòe để nổ" : "Đang chờ camera..."}
      </div>
    </div>
  );
}
