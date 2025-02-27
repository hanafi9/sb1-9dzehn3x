import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

const ParkingZone = ({ position, size, color, name, occupancy }) => {
  const mesh = useRef();

  useFrame((state) => {
    if (mesh.current) {
      mesh.current.rotation.y += 0.001;
      mesh.current.position.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.05 + size[1] / 2;
    }
  });

  return (
    <group position={[position[0], 0, position[2]]}>
      {/* Base du parking */}
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <boxGeometry args={[size[0] + 0.2, 0.1, size[2] + 0.2]} />
        <meshStandardMaterial
          color="#2c3e50"
          roughness={0.8}
          metalness={0.2}
        />
      </mesh>

      {/* Zone de parking principale */}
      <mesh ref={mesh} castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshPhysicalMaterial
          color={color}
          transparent
          opacity={0.8}
          roughness={0.2}
          metalness={0.3}
          clearcoat={0.5}
          clearcoatRoughness={0.1}
        />
      </mesh>

      {/* Marqueurs de places */}
      {Array.from({ length: 4 }).map((_, i) => (
        <mesh
          key={i}
          position={[
            (i % 2) * (size[0] / 2) - size[0] / 4,
            0.1,
            Math.floor(i / 2) * (size[2] / 2) - size[2] / 4
          ]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[0.8, 1.6]} />
          <meshStandardMaterial color="#ffffff" opacity={0.5} transparent />
        </mesh>
      ))}

      {/* Texte d'information */}
      <group position={[0, size[1] + 0.5, 0]}>
        <Text
          position={[0, 0.3, 0]}
          fontSize={0.5}
          color="white"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.02}
          outlineColor="#000000"
        >
          {name}
        </Text>
        <Text
          position={[0, -0.3, 0]}
          fontSize={0.7}
          color={occupancy > 80 ? '#ef4444' : occupancy > 50 ? '#f59e0b' : '#22c55e'}
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.02}
          outlineColor="#000000"
        >
          {`${occupancy}%`}
        </Text>
      </group>
    </group>
  );
};

const Ground = () => {
  const textureUrl = "https://images.unsplash.com/photo-1621799754487-da87215c44e8?w=1600&auto=format&fit=crop&q=80";
  const texture = new THREE.TextureLoader().load(textureUrl);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 5);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial
        map={texture}
        roughness={0.8}
        metalness={0.2}
      />
    </mesh>
  );
};

const ParkingMap3D = () => {
  const zones = [
    { name: 'Zone A', position: [-4, 1, 0], size: [3, 2, 3], color: '#3B82F6', occupancy: 85 },
    { name: 'Zone B', position: [0, 1, 0], size: [3, 2, 3], color: '#10B981', occupancy: 60 },
    { name: 'Zone C', position: [4, 1, 0], size: [3, 2, 3], color: '#8B5CF6', occupancy: 45 },
    { name: 'Zone VIP', position: [0, 1, -4], size: [4, 2, 2], color: '#F59E0B', occupancy: 90 },
  ];

  return (
    <div className="w-full h-[400px] rounded-xl overflow-hidden">
      <Canvas
        camera={{ position: [15, 15, 15], fov: 50 }}
        shadows
      >
        <color attach="background" args={['#1e293b']} />
        <fog attach="fog" args={['#1e293b', 30, 50]} />
        
        {/* Éclairage */}
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[5, 5, 5]}
          intensity={1}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <pointLight position={[-5, 5, -5]} intensity={0.5} />

        {/* Environnement */}
        <Environment preset="city" />
        
        {/* Sol et ombres */}
        <Ground />
        <ContactShadows
          opacity={0.5}
          scale={20}
          blur={1}
          far={10}
          resolution={256}
          color="#000000"
        />

        {/* Contrôles */}
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={5}
          maxDistance={30}
          maxPolarAngle={Math.PI / 2.1}
        />

        {/* Zones de parking */}
        {zones.map((zone, index) => (
          <ParkingZone key={index} {...zone} />
        ))}
      </Canvas>
    </div>
  );
};

export default ParkingMap3D;