import * as THREE from 'https://esm.sh/three@0.166.1';
import { OrbitControls } from 'https://esm.sh/three@0.166.1/examples/jsm/controls/OrbitControls.js';
import { FontLoader } from 'https://esm.sh/three@0.166.1/examples/jsm/loaders/FontLoader.js';
import { RGBELoader } from 'https://esm.sh/three@0.166.1/examples/jsm/loaders/RGBELoader.js';
import { Lensflare, LensflareElement } from "https://esm.sh/three@0.166.1/examples/jsm/objects/Lensflare.js";

// 1. Scene
const scene = new THREE.Scene();

// 2. Camera
// Using a PerspectiveCamera suitable for 3D space.
// The near/far planes are set wide, but the logarithmic depth buffer handles the precision.
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1e12); // Match far plane to max zoom
camera.position.set(0, 20, 100);

// 3. Renderer
// The renderer is configured for high-quality, large-scale scenes.
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    // The logarithmic depth buffer is crucial for rendering scenes with vast
    // differences in depth without visual artifacts (z-fighting).
    logarithmicDepthBuffer: true
});
renderer.setSize(window.innerWidth, window.innerHeight);

// Use ACESFilmicToneMapping for a more cinematic and realistic lighting look.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0; // Matched to reference for a brighter scene

// Enable shadow mapping for realistic lighting physics
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadow edges

document.body.appendChild(renderer.domElement);

// 4. Controls
// OrbitControls allow the user to pan, zoom, and rotate the camera.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // Creates a smoother, more natural camera movement
controls.dampingFactor = 0.05;
controls.minDistance = 0.1;
controls.maxDistance = 1e12; // Effectively remove zoom cap

// 5. Lighting & Environment
// An HDRI provides both the background and the ambient, image-based lighting.
// This is more realistic than a simple ambient light color.
const rgbeLoader = new RGBELoader();
// Note: You need to provide a path to your own .hdr file.
rgbeLoader.load(
    'textures/hdr/space.hdr', 
    (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = texture;
        scene.environment = texture; // Provides ambient light and reflections
    },
    // onProgress callback (optional)
    undefined,
    // onError callback
    (error) => {
        console.error('An error occurred while loading the HDRI file.', error);
    }
);

// --- Sun, Lighting, and Lens Flare ---
// For physically correct lighting, we use 'power' (in lumens) instead of 'intensity'.
// The decay property of 2 is the physically correct inverse-square falloff.
const sunLight = new THREE.PointLight(0xffffff, 1.0); // Intensity is now a multiplier for power
sunLight.power = 4 * Math.PI * 100000; // A high power value to illuminate distant planets
sunLight.decay = 2;
sunLight.position.set(0, 0, 0);

// Enable shadow casting for the sun's light
sunLight.castShadow = false; // Disabled to remove pixelated shadows
scene.add(sunLight);

// Add an ambient light to ensure planets are not completely black.
const ambientLight = new THREE.AmbientLight(0xffffff, 0.05); // Reduced for more dramatic shadows
scene.add(ambientLight);

const loader = new THREE.TextureLoader();
const planetTextures = {
  sun: loader.load('textures/stars/2k_sun.png'),
  sun_blue: loader.load('textures/stars/2k_sun_blue.png'),
  sun_orange: loader.load('textures/stars/2k_sun_orange.png'),
  sun_red: loader.load('textures/stars/2k_sun_red.png'),
  mercury: loader.load('textures/planets/2k_mercury.jpg'),
  venusSurface: loader.load('textures/planets/2k_venus_surface.jpg'),
  venusAtmos: loader.load('textures/planets/2k_venus_atmosphere.jpg'),
  earth: loader.load('textures/planets/2k_earth.jpg'),
  mars: loader.load('textures/planets/2k_mars.jpg'),
  jupiter: loader.load('textures/planets/2k_jupiter.jpg'),
  saturn: loader.load('textures/planets/2k_saturn.jpg'),
  uranus: loader.load('textures/planets/2k_uranus.jpg'),
  moon: loader.load('textures/moons/2k_moon.jpg'),
  neptune: loader.load('textures/planets/2k_neptune.jpg'),
  saturnRing: loader.load('textures/planets/2k_saturn_ring_alpha.png'),
  flare0: loader.load("textures/lensflare/stellar_starview.png"),
  flare3: loader.load("textures/lensflare/stellar_starview.png"),
  star: loader.load('textures/lensflare/stellar_starview.png'), // Reverted to use the stylized star view texture
  star_blue: loader.load('textures/lensflare/stellar_starview_blue.png'), // Texture for blue stars
  galaxy: loader.load('textures/galaxy.png') // Texture for the galactic view
};

// --- Global Scene Object Arrays ---
const planets = [];
const moons = [];
const orbitRings = [];
const labels = [];
const systemLabels = {}; // For multi-star system labels
const starMeshes = []; // For system-scale star meshes
const starLights = []; // For system-scale star lights
const stellarObjects = []; // For nearby stars. Each element is { mesh, label, system }
let intersectableObjects = []; // Will be dynamically populated in the animation loop
const searchableObjects = []; // Unified list for the search functionality

// Sun Mesh (emissive, not affected by scene lights)
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(1, 64, 64),
  new THREE.MeshBasicMaterial({ map: planetTextures.sun, transparent: true, depthWrite: false })
);
sun.name = 'Sol'; // Assign a name for raycasting and UI
scene.add(sun);

// Create a sprite for Sol to be visible at interstellar distances, and add it to stellarObjects.
const solSpriteMaterial = new THREE.SpriteMaterial({
    map: planetTextures.star,
    color: 0xFFF4D5, // G2V star color
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0,
    depthWrite: false // Prevent sprite from blocking other transparent objects
});
const solSprite = new THREE.Sprite(solSpriteMaterial);
solSprite.position.set(0, 0, 0);
solSprite.scale.set(50000 * 10, 50000 * 10, 1.0); // Similar to other G-type stars, scaled up
solSprite.name = 'Sol'; // Use 'Sol' to match focusing logic
scene.add(solSprite);

// Create a dedicated interstellar label for Sol's sprite
const solInterstellarLabel = createLabel('Sol', solSprite);
labels.push(solInterstellarLabel);

// Add Sol's sprite and its new interstellar label to the list of stellar objects.
stellarObjects.push({ mesh: solSprite, label: solInterstellarLabel, system: 'Sol' });


// Lens Flare
const lensflare = new Lensflare();
// lensflare.addElement(new LensflareElement(planetTextures.flare0, 512, 0));
// lensflare.addElement(new LensflareElement(planetTextures.flare3, 60, 0.6));
// lensflare.addElement(new LensflareElement(planetTextures.flare3, 70, 0.7));
// lensflare.addElement(new LensflareElement(planetTextures.flare3, 120, 0.9));
// lensflare.addElement(new LensflareElement(planetTextures.flare3, 70, 1));
// sunLight.add(lensflare); // The "rays" are now disabled

// This fix prevents rendering glitches when lens flares are used with other transparent objects.
// It defers the material modification until after the first render.
// requestAnimationFrame(() => {
//     lensflare.lensflares.forEach(flare => {
//         flare.material.depthTest = false;
//         flare.material.depthWrite = false;
//     });
// });

// --- Planet Data & Creation ---
const planetData = [
  {name:'Mercury', radius:0.38, distance: 35 * 0.39, eccentricity: 0.205, inclination: 7.00, lan: 48.3, axialTilt: 0.03, orbitSpeed:0.04, rotationSpeed:0.02, texture:'mercury'},
  {name:'Venus',   radius:0.95, distance: 35 * 0.72, eccentricity: 0.007, inclination: 3.39, lan: 76.7, axialTilt: 177.3, orbitSpeed:0.015, rotationSpeed:0.01, texture:'venus'},
  {name:'Earth',   radius:1,    distance: 35 * 1.00, eccentricity: 0.017, inclination: 0.00, lan: -11.2, axialTilt: 23.4, orbitSpeed:0.01, rotationSpeed:0.02, texture:'earth', moons: [
    { name: 'Luna', radius: 0.27, distance: 2.5, eccentricity: 0.054, inclination: 5.1, lan: 0, axialTilt: 6.7, orbitSpeed: 0.1, rotationSpeed: 0.01, texture: 'moon' }
  ]},
  {name:'Mars',    radius:0.53, distance: 35 * 1.52, eccentricity: 0.094, inclination: 1.85, lan: 49.6, axialTilt: 25.2, orbitSpeed:0.008, rotationSpeed:0.018, texture:'mars'},
  {name:'Jupiter', radius:8.5,  distance: 35 * 5.20, eccentricity: 0.049, inclination: 1.31, lan: 100.5, axialTilt: 3.1, orbitSpeed:0.005, rotationSpeed:0.04, texture:'jupiter', moons: [
    { name: 'Io', radius: 0.28, distance: 12, eccentricity: 0.004, inclination: 0.05, lan: 0, axialTilt: 0, orbitSpeed: 0.4, rotationSpeed: 0.1, texture: 'moon' },
    { name: 'Europa', radius: 0.24, distance: 15, eccentricity: 0.009, inclination: 0.47, lan: 0, axialTilt: 0, orbitSpeed: 0.3, rotationSpeed: 0.08, texture: 'moon' },
    { name: 'Ganymede', radius: 0.41, distance: 19, eccentricity: 0.001, inclination: 0.20, lan: 0, axialTilt: 0, orbitSpeed: 0.2, rotationSpeed: 0.05, texture: 'moon' },
    { name: 'Callisto', radius: 0.38, distance: 24, eccentricity: 0.007, inclination: 0.20, lan: 0, axialTilt: 0, orbitSpeed: 0.1, rotationSpeed: 0.03, texture: 'moon' }
  ]},
  {name:'Saturn',  radius:7.5,  distance: 35 * 9.58, eccentricity: 0.057, inclination: 2.49, lan: 113.7, axialTilt: 26.7, orbitSpeed:0.003, rotationSpeed:0.038, texture:'saturn', ring:true},
  {name:'Uranus',  radius:3.5,  distance: 35 * 19.22, eccentricity: 0.046, inclination: 0.77, lan: 74.0, axialTilt: 97.8, orbitSpeed:0.002, rotationSpeed:0.03, texture:'uranus'},
  {name:'Neptune', radius:3.3,  distance: 35 * 30.05, eccentricity: 0.011, inclination: 1.77, lan: 131.8, axialTilt: 28.3, orbitSpeed:0.0015, rotationSpeed:0.03, texture:'neptune'}
];

// Fictional exoplanet for Barnard's Star. Using existing textures as placeholders.
const exoplanetData = [
    // Data based on real, confirmed exoplanets. Distances are in AU.
    // Proxima Centauri System
    { star: "Proxima Centauri", name: "Proxima Centauri d", radius: 0.81, distance: 35 * 0.02885, eccentricity: 0.04, inclination: 133, lan: 149, axialTilt: 10.0, orbitSpeed: 0.25, rotationSpeed: 0.03, texture: 'mercury' },
    { star: "Proxima Centauri", name: "Proxima Centauri b", radius: 1.07, distance: 35 * 0.04857, eccentricity: 0.0, inclination: 133, lan: 149, axialTilt: 10.0, orbitSpeed: 0.18, rotationSpeed: 0.02, texture: 'mars' }, // In habitable zone
    
    // Barnard's Star System
    { star: "Barnard's Star", name: "Barnard's Star b", radius: 1.3, distance: 35 * 0.404, eccentricity: 0.32, inclination: 90, lan: 120, axialTilt: 10.0, orbitSpeed: 0.02, rotationSpeed: 0.03, texture: 'uranus' }, // A cold super-Earth

    // Epsilon Eridani System
    { star: "Epsilon Eridani", name: "Epsilon Eridani b", radius: 8.0, distance: 35 * 3.48, eccentricity: 0.07, inclination: 34, lan: 11, axialTilt: 5.0, orbitSpeed: 0.006, rotationSpeed: 0.04, texture: 'jupiter' },

    // Tau Ceti System
    { star: "Tau Ceti", name: "Tau Ceti g", radius: 1.1, distance: 35 * 0.133, eccentricity: 0.08, inclination: 35, lan: 188, axialTilt: 15.0, orbitSpeed: 0.1, rotationSpeed: 0.02, texture: 'venusSurface' },
    { star: "Tau Ceti", name: "Tau Ceti h", radius: 1.1, distance: 35 * 0.243, eccentricity: 0.08, inclination: 35, lan: 188, axialTilt: 15.0, orbitSpeed: 0.07, rotationSpeed: 0.02, texture: 'earth' },
    { star: "Tau Ceti", name: "Tau Ceti e", radius: 1.5, distance: 35 * 0.538, eccentricity: 0.18, inclination: 35, lan: 188, axialTilt: 15.0, orbitSpeed: 0.04, rotationSpeed: 0.03, texture: 'mars' }, // In habitable zone
    { star: "Tau Ceti", name: "Tau Ceti f", radius: 1.5, distance: 35 * 1.334, eccentricity: 0.16, inclination: 35, lan: 188, axialTilt: 15.0, orbitSpeed: 0.02, rotationSpeed: 0.03, texture: 'neptune' }, // In habitable zone
];

// --- Interstellar Objects Data ---
const sceneUnitsPerAU = 35;
const auPerLy = 63241.1;
const sceneUnitsPerLy = sceneUnitsPerAU * auPerLy;

// Database of nearby stars
const starDatabase = [
    { system: "Alpha Centauri", name: "Alpha Centauri A", class: "G2V", radius: 1.22, dist: 4.37, ra: "14h 39m 36s", dec: "-60° 50' 02\"", color: 0xFFF4D5, scale: 55000 }, // G-type -> sun
    { system: "Alpha Centauri", name: "Alpha Centauri B", class: "K1V", radius: 0.86, dist: 4.37, ra: "14h 39m 35s", dec: "-60° 50' 12\"", color: 0xFFD580, scale: 45000 }, // K-type -> orange
    { system: "Alpha Centauri", name: "Proxima Centauri", class: "M5.5Ve", radius: 0.15, dist: 4.24, ra: "14h 29m 42s", dec: "-62° 40' 46\"", color: 0xFF8C61, scale: 15000 }, // M-type -> red
    { system: "Sirius", name: "Sirius", class: "A1V", radius: 1.71, dist: 8.6, ra: "06h 45m 08s", dec: "-16° 42' 58\"", color: 0xffffff, scale: 85000 }, // A-type -> blue
    { system: "Barnard's Star", name: "Barnard's Star", class: "M4.0V", radius: 0.19, dist: 5.96, ra: "17h 57m 48s", dec: "+04° 41' 36\"", color: 0xFF9E6D, scale: 20000 }, // M-type -> red
    { system: "Wolf 359", name: "Wolf 359", class: "M6.5V", radius: 0.16, dist: 7.9, ra: "10h 56m 28s", dec: "+07° 00' 52\"", color: 0xC75A3A, scale: 16000 }, // M-type -> red
    { system: "Lalande 21185", name: "Lalande 21185", class: "M2.0V", radius: 0.39, dist: 8.31, ra: "11h 03m 20s", dec: "+35° 58' 11\"", color: 0xFFAD60, scale: 38000 }, // M-type -> red
    { system: "Luyten's Star", name: "Luyten's Star", class: "M3.5V", radius: 0.29, dist: 12.36, ra: "07h 27m 24s", dec: "+05° 13' 32\"", color: 0xFF9E6D, scale: 28000 }, // M-type -> red
    { system: "Epsilon Eridani", name: "Epsilon Eridani", class: "K2V", radius: 0.73, dist: 10.5, ra: "03h 32m 55s", dec: "-09° 27' 29\"", color: 0xFFD580, scale: 42000 }, // K-type -> orange
    { system: "Tau Ceti", name: "Tau Ceti", class: "G8.5V", radius: 0.79, dist: 11.9, ra: "01h 44m 04s", dec: "-15° 56' 14\"", color: 0xFFF0C9, scale: 48000 }, // G-type -> sun
];
const starSystems = {}; // To hold system data like center position

// A scaling factor to make planets proportionally smaller than stars.
const planetScaleFactor = 0.1;

function createMoon(moonData, planetGroup) {
    const moonMesh = new THREE.Mesh(
        new THREE.SphereGeometry(moonData.radius * planetScaleFactor, 16, 16),
        new THREE.MeshStandardMaterial({ map: planetTextures[moonData.texture], roughness: 0.7, transparent: true, opacity: 0 })
    );
    moonMesh.name = moonData.name;
    moonMesh.material.depthWrite = false; // Prevents rendering artifacts with other transparent objects
    planetGroup.add(moonMesh);

    const moonOrbit = createOrbit(moonData.distance, moonData.eccentricity, THREE.MathUtils.degToRad(moonData.inclination), THREE.MathUtils.degToRad(moonData.lan));
    moonOrbit.material.opacity = 0; // Start invisible

    const moonLabel = createLabel(moonData.name, moonMesh); // This line was missing a return statement
    moonLabel.element.style.opacity = 0; // Start transparent
    labels.push(moonLabel); // Add the moon's label to the global labels array for positioning

    moons.push({
        mesh: moonMesh,
        orbit: moonOrbit,
        label: moonLabel,
        a: moonData.distance,
        e: moonData.eccentricity,
        i: THREE.MathUtils.degToRad(moonData.inclination),
        lan: THREE.MathUtils.degToRad(moonData.lan),
        orbitSpeed: moonData.orbitSpeed,
        rotationSpeed: moonData.rotationSpeed,
        theta: Math.random() * 2 * Math.PI
    });

    searchableObjects.push({ name: moonData.name, type: 'moon', object: moonMesh });

    // Return the created objects so they can be added to the scene graph correctly.
    return {
        mesh: moonMesh,
        orbit: moonOrbit,
        label: moonLabel
    };
}

function createCelestialObject(data) {
    const planetGroup = new THREE.Group();
    planetGroup.name = data.name;

    let surfaceMesh;

    if (data.name === 'Venus') {
        surfaceMesh = new THREE.Mesh(
            new THREE.SphereGeometry(data.radius * planetScaleFactor, 32, 32),
            new THREE.MeshStandardMaterial({ map: planetTextures.venusSurface, roughness: 0.5, metalness: 0.1 })
        );
        const atmosMesh = new THREE.Mesh(
            new THREE.SphereGeometry(data.radius * planetScaleFactor * 1.02, 32, 32),
            new THREE.MeshStandardMaterial({
                map: planetTextures.venusAtmos,
                transparent: true,
                opacity: 0.6,
                roughness: 0.7,
                metalness: 0.1
            })
        );
        surfaceMesh.add(atmosMesh);
    } else {
        surfaceMesh = new THREE.Mesh(
            new THREE.SphereGeometry(data.radius * planetScaleFactor, 32, 32),
            new THREE.MeshStandardMaterial({ map: planetTextures[data.texture], roughness: 0.5, metalness: 0.1 })
        );
    }
    planetGroup.add(surfaceMesh);

    // Enable shadow casting and receiving for the main planet mesh
    // We traverse because for Venus, the surface is a child of the group.
    surfaceMesh.traverse(child => {
        if (child.isMesh) {
            child.castShadow = false;
            child.receiveShadow = false;
        }
    });

    if (data.ring) {
        const innerRadius = data.radius * planetScaleFactor * 1.2;
        const outerRadius = data.radius * planetScaleFactor * 2;
        const ringGeo = new THREE.RingGeometry(innerRadius, outerRadius, 64);
        ringGeo.rotateX(-Math.PI / 2);

        const pos = ringGeo.attributes.position;
        const v3 = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++){
            v3.fromBufferAttribute(pos, i);
            ringGeo.attributes.uv.setXY(i, (v3.length() - innerRadius) / (outerRadius - innerRadius), 1);
        }

        const ringMat = new THREE.MeshStandardMaterial({
            map: planetTextures.saturnRing,
            side: THREE.DoubleSide,
            transparent: true,
            // Crucial for preventing rendering artifacts with other transparent objects.
            depthWrite: false
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        // Rings should receive shadows from the planet, but not cast them (for performance)
        ringMesh.receiveShadow = false;
        planetGroup.add(ringMesh);
    }

    if (data.moons) {
        data.moons.forEach(moonData => {
            const moon = createMoon(moonData, planetGroup);
            // Add the moon's orbit as a child of the planet group
            // so it moves with the planet.
            planetGroup.add(moon.orbit);
        });
    }

    planetGroup.rotation.z = THREE.MathUtils.degToRad(data.axialTilt);
    return planetGroup;
}

function createLabel(name, objectToTrack) {
    const labelDiv = document.createElement('div');
    labelDiv.className = 'label';
    labelDiv.textContent = name;
    labelDiv.addEventListener('click', (event) => {
        event.stopPropagation(); // Prevent the global 'onMouseClick' from firing
        if (showLabelsCheckbox.checked) {
            focusedObject = objectToTrack;
            updateInfoPanel();
        }
    });

    // Forward wheel events from the label to the canvas to enable zooming over labels.
    labelDiv.addEventListener('wheel', (event) => {
        event.preventDefault(); // Prevent the page from scrolling when zooming over a label.
        // Re-dispatch the event onto the canvas so OrbitControls can handle it.
        renderer.domElement.dispatchEvent(new WheelEvent(event.type, event));
    }, {
        passive: false
    }); // 'passive: false' is required to allow preventDefault.

    document.getElementById('labels-container').appendChild(labelDiv);
    return {
        element: labelDiv,
        object: objectToTrack,
        visible: true // Controlled by checkbox
    };
}

function createOrbit(a, e, i, lan) {
    const points = [];
    const numPoints = 256;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(i, lan, 0, 'YXZ'));

    for (let j = 0; j <= numPoints; j++) {
        const theta = (j / numPoints) * 2 * Math.PI;
        const r = a * (1 - e * e) / (1 + e * Math.cos(theta));
        const pos = new THREE.Vector3(r * Math.cos(theta), 0, r * Math.sin(theta));
        pos.applyQuaternion(q);
        points.push(pos);
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
        color: 0x99ffff,
        transparent: true,
        opacity: 0.5,
        depthWrite: false // Prevents the far side of the orbit from being culled
    });
    const ellipse = new THREE.Line(geometry, material);

    // Disable frustum culling to prevent the orbit line from disappearing when its
    // bounding sphere is off-camera, which can happen with large, eccentric orbits.
    ellipse.frustumCulled = false;

    // Set a renderOrder to ensure transparent lines are drawn after opaque objects,
    // which fixes sorting issues when using a logarithmic depth buffer.
    ellipse.renderOrder = 1;
    return ellipse;
}

function createSystemLabel(systemName, position) {
    const labelDiv = document.createElement('div');
    labelDiv.className = 'label';
    labelDiv.textContent = systemName;
    labelDiv.addEventListener('click', (event) => {
        event.stopPropagation();
        // Focus on the first star of the system when the system label is clicked.
        const system = starSystems[systemName];
        if (system && system.stars.length > 0) {
            focusedObject = system.stars[0];
            updateInfoPanel();
        }
    });
    labelDiv.style.opacity = 0; // Start invisible

    // Add wheel event listener to prevent page scrolling when zooming over the label.
    labelDiv.addEventListener('wheel', (event) => {
        event.preventDefault();
        renderer.domElement.dispatchEvent(new WheelEvent(event.type, event));
    }, {
        passive: false
    });

    document.getElementById('labels-container').appendChild(labelDiv);

    systemLabels[systemName] = {
        element: labelDiv,
        position: position // The central position of the star system
    };
}

// Create label for the Sun
labels.push(createLabel('Sol', sun));

// Add Sol to the searchable list. It's a special case not covered in other loops.
searchableObjects.push({ name: 'Sol', type: 'star', object: sun });

const allPlanetData = [...planetData, ...exoplanetData];

allPlanetData.forEach(data => {
  const planetObject = createCelestialObject(data);
  scene.add(planetObject);

  const orbitRing = createOrbit(data.distance, data.eccentricity, THREE.MathUtils.degToRad(data.inclination), THREE.MathUtils.degToRad(data.lan));
  // Add the planet's orbit to the scene. It will be positioned later.
  scene.add(orbitRing);
  orbitRings.push(orbitRing);

  // Create a label for the planet
  labels.push(createLabel(data.name, planetObject));

    searchableObjects.push({ name: data.name, type: 'planet', object: planetObject });

  planets.push({
    starName: data.star || 'Sol', // Default to Sol if not specified
    planet: planetObject,
    a: data.distance, // semi-major axis
    e: data.eccentricity,
    i: THREE.MathUtils.degToRad(data.inclination),
    lan: THREE.MathUtils.degToRad(data.lan),
    orbitSpeed: data.orbitSpeed,
    rotationSpeed: data.rotationSpeed,
    theta: Math.random() * 2 * Math.PI, // Random starting angle
    orbitRing: orbitRing
  });
});

function createStar(data) {
    // 1. Convert astronomical coordinates to radians
    const raParts = data.ra.match(/(\d+)h (\d+)m (\d+)s/);
    const ra = (parseInt(raParts[1]) + parseInt(raParts[2])/60 + parseInt(raParts[3])/3600) * (15 * Math.PI/180);

    const decParts = data.dec.match(/([+-])(\d+)° (\d+)' (\d+)"/);
    const decSign = decParts[1] === '-' ? -1 : 1;
    const dec = (parseInt(decParts[2]) + parseInt(decParts[3])/60 + parseInt(decParts[4])/3600) * (Math.PI/180) * decSign;

    // 2. Convert spherical to Cartesian coordinates
    const dist = data.dist * sceneUnitsPerLy;
    const x = dist * Math.cos(dec) * Math.cos(ra);
    const y = dist * Math.sin(dec);
    const z = dist * Math.sin(ra);

    // --- Create the system-scale star mesh (like the sun) ---
    const sunMeshRadius = 1; // The base radius of the sun mesh

    let systemStarTexture = planetTextures.sun;
    let systemStarColor = data.color;

    // Select the correct texture based on spectral class
    const spectralType = data.class.charAt(0).toUpperCase();
    if (spectralType === 'A' || spectralType === 'B') {
        systemStarTexture = planetTextures.sun_blue;
        systemStarColor = 0xffffff; // Use neutral white to not tint the pre-colored texture
    } else if (spectralType === 'K') {
        systemStarTexture = planetTextures.sun_orange;
        systemStarColor = 0xffffff;
    } else if (spectralType === 'M') {
        systemStarTexture = planetTextures.sun_red;
        systemStarColor = 0xffffff;
    }

    const starMesh = new THREE.Mesh(
        new THREE.SphereGeometry(data.radius * sunMeshRadius, 64, 64),
        new THREE.MeshBasicMaterial({
            map: systemStarTexture,
            color: systemStarColor,
            transparent: true,
            opacity: 0, // Start invisible
            depthWrite: false
        })
    );
    starMesh.position.set(x, y, z);
    starMesh.name = data.name;
    scene.add(starMesh);

    // Create a separate label for the system-scale mesh
    const starMeshLabel = createLabel(data.name, starMesh);
    labels.push(starMeshLabel);
    starMeshes.push({ mesh: starMesh, label: starMeshLabel }); // Add to a new array for fading

    // --- Create a light source for the star ---
    const starLight = new THREE.PointLight(data.color, 1.0);
    // Scale light power based on star's radius squared (L ∝ R^2 * T^4, this is a simplification)
    // Use a base power similar to the sun's light.
    const basePower = 4 * Math.PI * 100000;
    starLight.power = basePower * (data.radius ** 2);
    starLight.decay = 2; // Physically correct falloff
    starLight.position.set(x, y, z);
    starLight.visible = false; // Start invisible, fade in with scale
    scene.add(starLight);
    starLights.push(starLight);



    let starTexture = planetTextures.star;
    let starColor = data.color;

    // If the star is a blue A-type star, use the dedicated blue texture
    if (data.class.startsWith('A')) {
        starTexture = planetTextures.star_blue;
        starColor = 0xffffff; // Use neutral white to not tint the blue texture
    }

    // --- Create the interstellar star sprite ---
    const spriteMaterial = new THREE.SpriteMaterial({
        map: starTexture,
        color: starColor,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0, // Start invisible, fade in with distance
        depthWrite: false // Prevent sprite from blocking other transparent objects
    });
    const starSprite = new THREE.Sprite(spriteMaterial);
    starSprite.position.set(x, y, z);
    starSprite.scale.set(data.scale * 10, data.scale * 10, 1.0);
    starSprite.name = data.name; // For focusing
    scene.add(starSprite);
    
    const starLabel = createLabel(data.name, starSprite);
    labels.push(starLabel);

    stellarObjects.push({ mesh: starSprite, label: starLabel, system: data.system });

    searchableObjects.push({ name: data.name, type: 'star', object: starSprite });

    // Group stars by system
    if (!starSystems[data.system]) {
        starSystems[data.system] = { stars: [], center: new THREE.Vector3() };
    }
    starSystems[data.system].stars.push(starSprite);
}

// Calculate system centers and create system labels
starDatabase.forEach(createStar);
Object.keys(starSystems).forEach(systemName => {
    const system = starSystems[systemName];
    system.stars.forEach(star => system.center.add(star.position));
    system.center.divideScalar(system.stars.length);
    createSystemLabel(systemName, system.center);
});

function createStarfield() {
    const starCount = 20000;
    const vertices = [];
    // Define a shell for the starfield to ensure nearby stars are the closest objects.
    const minRadius = 20 * sceneUnitsPerLy; // Start beyond the nearby stars
    const maxRadius = 150 * sceneUnitsPerLy; // Extend well beyond the galactic transition point

    for (let i = 0; i < starCount; i++) {
        // Generate a random point on a sphere, then scale it by a random radius
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);

        // Generate a radius within the shell for uniform volume distribution
        const r = Math.cbrt(THREE.MathUtils.lerp(minRadius**3, maxRadius**3, Math.random()));
        
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        vertices.push(x, y, z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 50,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0 // Start invisible
    });

    const starfield = new THREE.Points(geometry, material);
    scene.add(starfield);
    return starfield;
}

const starfield = createStarfield();

function createProceduralGalaxy() {
    const starCount = 100000;
    const armCount = 4;
    const galaxyRadius = sceneUnitsPerLy * 50000; // 50k light-years radius
    const barLength = galaxyRadius * 0.4;
    const barWidth = galaxyRadius * 0.08;
    const armRotation = 2.5; // How tightly the arms are wound
    const randomness = 0.5;

    const vertices = [];
    const colors = [];
    const baseColor = new THREE.Color(0x88aaff);

    for (let i = 0; i < starCount; i++) {
        const isBarStar = i < starCount * 0.2; // 20% of stars in the central bar
        let x, y, z, r, theta;

        if (isBarStar) {
            x = THREE.MathUtils.randFloatSpread(barLength);
            y = THREE.MathUtils.randFloatSpread(barWidth * 0.2); // Flatter bar
            z = THREE.MathUtils.randFloatSpread(barWidth);
        } else {
            r = Math.random() * galaxyRadius;
            const armIndex = i % armCount;
            theta = (r / galaxyRadius) * armRotation + (armIndex / armCount) * 2 * Math.PI;

            // Add randomness to make arms look less perfect
            const randomAngle = (Math.random() - 0.5) * randomness;
            const randomRadius = (Math.random() - 0.5) * randomness * r * 0.5;

            x = Math.cos(theta + randomAngle) * (r + randomRadius);
            y = THREE.MathUtils.randFloatSpread(galaxyRadius * 0.05); // Make the galaxy disk flat
            z = Math.sin(theta + randomAngle) * (r + randomRadius);
        }

        vertices.push(x, y, z);

        // Color variation
        const color = baseColor.clone();
        color.lerp(new THREE.Color(0xffddaa), Math.random() * 0.4);
        colors.push(color.r, color.g, color.b);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 1500,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0 // Start invisible
    });
    const galaxyPoints = new THREE.Points(geometry, material);
    scene.add(galaxyPoints);
    return galaxyPoints;
}

const galaxy = createProceduralGalaxy();

// --- Font Loading for 3D Text (Placeholder for future use if needed) ---
// const fontLoader = new FontLoader();
// fontLoader.load('fonts/Conthrax_Regular.json', (font) => {
//     // You can create 3D text geometry here
// });

// --- UI Controls ---
const showOrbitsCheckbox = document.getElementById('show-orbits-checkbox');
showOrbitsCheckbox.addEventListener('change', (e) => {
    orbitRings.forEach(ring => {
        ring.visible = e.target.checked;
    });
});

const showLabelsCheckbox = document.getElementById('show-labels-checkbox');
showLabelsCheckbox.addEventListener('change', (e) => {
    const isVisible = e.target.checked;
    const labelsContainer = document.getElementById('labels-container');
    // This only toggles the labels, it should not affect the info panel
    // or the focusedObject state.
    labelsContainer.style.visibility = isVisible ? 'visible' : 'hidden'; 
});

const pauseAnimationCheckbox = document.getElementById('pause-animation-checkbox');
const speedDisplay = document.getElementById('speed-display');

const speedLevels = [
    { name: 'Very Slow', multiplier: 0.1 },
    { name: 'Slow',      multiplier: 0.5 },
    { name: 'Normal',    multiplier: 1.0 },
    { name: 'Fast',      multiplier: 2.0 },
    { name: 'Very Fast', multiplier: 5.0 }
];
let currentSpeedIndex = 2; // Start at 'Normal'
let isAnimationPaused = false;
let animationSpeed = speedLevels[currentSpeedIndex].multiplier;

function updateSpeed() {
    animationSpeed = speedLevels[currentSpeedIndex].multiplier;
    speedDisplay.textContent = speedLevels[currentSpeedIndex].name;
    // Unpause if a speed is selected via arrows
    if (isAnimationPaused) {
        isAnimationPaused = false;
        pauseAnimationCheckbox.checked = false;
    }
}

window.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') {
        currentSpeedIndex = Math.min(currentSpeedIndex + 1, speedLevels.length - 1);
        updateSpeed();
    } else if (event.key === 'ArrowLeft') {
        currentSpeedIndex = Math.max(currentSpeedIndex - 1, 0);
        updateSpeed();
    }
});

const speedUpBtn = document.getElementById('speed-up-btn');
const speedDownBtn = document.getElementById('speed-down-btn');

speedUpBtn.addEventListener('click', () => {
    currentSpeedIndex = Math.min(currentSpeedIndex + 1, speedLevels.length - 1);
    updateSpeed();
});

speedDownBtn.addEventListener('click', () => {
    currentSpeedIndex = Math.max(currentSpeedIndex - 1, 0);
    updateSpeed();
});

pauseAnimationCheckbox.addEventListener('change', (e) => {
    isAnimationPaused = e.target.checked;
    if (isAnimationPaused) {
        speedDisplay.textContent = 'Paused';
    } else {
        // Restore speed display when unpausing
        speedDisplay.textContent = speedLevels[currentSpeedIndex].name;
    }
});

const distanceCounter = document.getElementById('distance-counter');
const scaleIndicator = document.getElementById('scale-indicator');
const autoZoomIndicator = document.getElementById('auto-zoom-indicator');

// --- Raycasting and Focusing ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let focusedObject = null;

const infoBox = document.getElementById('info-box');
const infoName = document.getElementById('info-name');
const infoDetails = document.getElementById('info-details');

function onMouseClick(event) {
    // If the click originated from one of the UI containers, ignore it.
    // This prevents clicks on UI elements from being interpreted as clicks on the 3D scene.
    if (event.target.closest('#ui-container, #info-box, #distance-counter')) {
        return;
    }

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(intersectableObjects, true);

    if (intersects.length > 0) {
        let clickedObject = intersects[0].object;

        // Traverse up to find the main group object with the name
        while (clickedObject.parent && !clickedObject.name) {
            clickedObject = clickedObject.parent;
        }

        // Only change focus if a *different* object is clicked.
        // Re-clicking the same object will do nothing.
        if (focusedObject !== clickedObject) {
            focusedObject = clickedObject;
        }
    } else {
        // Clicked on empty space, unfocus
        focusedObject = null;
    }
    
    updateInfoPanel();
}

function updateInfoPanel() {
    if (!focusedObject) {
        infoBox.style.display = 'none';
        return;
    }

    const data = planetData.find(p => p.name === focusedObject.name);
    const starData = starDatabase.find(s => s.name === focusedObject.name);

    if (focusedObject.name === 'Sol') {
        infoName.textContent = 'Sol';
        infoDetails.innerHTML = `Type: Yellow Dwarf (G2V)<br>Radius: 696,340 km<br>The star at the center of our solar system.`;
        infoBox.style.display = 'block';
    } else if (data) {
        infoName.textContent = data.name;
        const earthRadiusKm = 6371;
        const planetRadiusKm = data.radius * earthRadiusKm;
        infoDetails.innerHTML = `Type: Planet<br>Parent Star: ${data.star || 'Unknown'}<br>Radius: ${planetRadiusKm.toLocaleString()} km (${data.radius}x Earth)`;
        infoBox.style.display = 'block';
    } else if (starData) { // Check for star data
        infoName.textContent = starData.name;
        const sunRadiusKm = 696340;
        const starRadiusKm = starData.radius * sunRadiusKm;
        const starTypeName = getStarTypeName(starData.class);
        infoDetails.innerHTML = `Type: ${starTypeName} (${starData.class})<br>Radius: ${starRadiusKm.toLocaleString()} km (${starData.radius}x Sol)<br>Distance from Sol: ${starData.dist} light-years`;
        infoBox.style.display = 'block';
    } else {
        infoBox.style.display = 'none';
    }
}

/**
 * Converts a spectral class code into a common descriptive name.
 * @param {string} spectralClass - The spectral class code (e.g., "G2V", "M5.5Ve").
 * @returns {string} A descriptive name for the star type.
 */
function getStarTypeName(spectralClass) {
    if (!spectralClass) return 'Unknown Star';
    const type = spectralClass.charAt(0).toUpperCase();

    // This is a simplified mapping. A more complex system could account for luminosity classes (V, III, I, etc.).
    switch (type) {
        case 'O': return 'Blue Supergiant';
        case 'B': return 'Blue-white Giant';
        case 'A': return 'Blue-white Star';
        case 'F': return 'White Star';
        case 'G': return 'Yellow Dwarf';
        case 'K': return 'Orange Dwarf';
        case 'M': return 'Red Dwarf';
        case 'L':
        case 'T':
        case 'Y': return 'Brown Dwarf';
        default: return 'Star';
    }
}

window.addEventListener('click', onMouseClick);

// --- Search Functionality ---
const searchInput = document.getElementById('search-input');
const suggestionsBox = document.getElementById('suggestions-box');
const filterSelect = document.getElementById('filter-select');

function updateSuggestions() {
    const query = searchInput.value.toLowerCase();
    const filter = filterSelect.value;
    suggestionsBox.innerHTML = '';

    if (query.length === 0) {
        suggestionsBox.style.display = 'none';
        return;
    }

    const filteredResults = searchableObjects.filter(item => {
        const nameMatch = item.name.toLowerCase().includes(query);
        const typeMatch = (filter === 'all') || (item.type === filter);
        return nameMatch && typeMatch;
    });

    if (filteredResults.length > 0) {
        filteredResults.forEach(item => {
            const suggestionDiv = document.createElement('div');
            suggestionDiv.textContent = item.name;
            suggestionDiv.style.padding = '8px';
            suggestionDiv.style.cursor = 'pointer';
            suggestionDiv.addEventListener('mouseenter', () => {
                suggestionDiv.style.backgroundColor = '#555';
            });
            suggestionDiv.addEventListener('mouseleave', () => {
                suggestionDiv.style.backgroundColor = 'transparent';
            });
            suggestionDiv.addEventListener('click', () => {
                focusedObject = item.object;
                updateInfoPanel();
                searchInput.value = ''; // Clear input
                suggestionsBox.style.display = 'none'; // Hide suggestions
            });
            suggestionsBox.appendChild(suggestionDiv);
        });
        suggestionsBox.style.display = 'block';
    } else {
        suggestionsBox.style.display = 'none';
    }
}

searchInput.addEventListener('input', updateSuggestions);
filterSelect.addEventListener('change', updateSuggestions);

// Hide suggestions when clicking outside the search wrapper
window.addEventListener('click', (event) => {
    if (!event.target.closest('#search-wrapper')) {
        suggestionsBox.style.display = 'none';
    }
});

// Prevent the main click handler from unfocusing when a suggestion is clicked
suggestionsBox.addEventListener('click', (event) => {
    event.stopPropagation();
});

// --- Credits Menu ---
const creditsButton = document.getElementById('credits-button');
const creditsPanel = document.getElementById('credits-panel');
const closeCreditsButton = document.getElementById('close-credits-button');

creditsButton.addEventListener('click', () => {
    creditsPanel.style.display = 'flex';
});

closeCreditsButton.addEventListener('click', () => {
    creditsPanel.style.display = 'none';
});

creditsPanel.addEventListener('click', (event) => {
    if (event.target === creditsPanel) creditsPanel.style.display = 'none';
});

// --- Auto-Zoom Logic ---
let currentScale = 'system'; // 'planet', 'system', 'interstellar', 'galactic'
let lastFocusedSystem = 'Sol'; // Track the last star system we were in
let lastFocusedStarPosition = new THREE.Vector3(0, 0, 0); // Track the position of the last focused star, default to Sol
let autoZoom = {
    active: false,
    startTime: 0,
    duration: 3000, // 3 seconds
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3()
};

// Cancel auto-zoom if user interacts with controls
controls.addEventListener('start', () => {
    if (autoZoom.active) {
        autoZoom.active = false;
        autoZoomIndicator.style.display = 'none';
    }
});

const useRealisticScale = true; // CONFIG TOGGLE

const CINEMATIC_SCALES = {
    PLANET_TO_SYSTEM: 50,             // Scene units
    SYSTEM_TO_INTERSTELLAR: 10000,     // AU
    INTERSTELLAR_TO_GALACTIC: 632410,  // 10 ly in AU
    INTERSTELLAR_VIEW_DIST: 316205,    // 5 ly in AU
    GALACTIC_VIEW_DIST: 150000 // AU
};

const REALISTIC_SCALES = {
    PLANET_TO_SYSTEM: 50,             // Scene units
    SYSTEM_TO_INTERSTELLAR: 63241,     // 1 ly in AU
    INTERSTELLAR_TO_GALACTIC: 3162055*2,  // 100 ly in AU
    INTERSTELLAR_VIEW_DIST: 200000,    // ~3 ly in AU
    GALACTIC_VIEW_DIST: 2.5e6,    // ~40 ly in AU
};

const SCALES = useRealisticScale ? REALISTIC_SCALES : CINEMATIC_SCALES;

function startAutoZoom(targetDist, targetFocus = new THREE.Vector3(0,0,0)) {
    autoZoom.active = true;
    autoZoom.startTime = performance.now();
    autoZoom.startPos.copy(camera.position);
    autoZoom.endPos.set(targetFocus.x, targetFocus.y + targetDist, targetFocus.z); // Position camera above the target focus point
    autoZoom.startTarget.copy(controls.target);
    autoZoom.endTarget.copy(targetFocus);
    autoZoomIndicator.style.display = 'block';
}

/**
 * Applies a fade effect to a celestial object, its orbit, and its label.
 * @param {object} celestial - The celestial object from the planets or moons array.
 * @param {number} opacity - The target opacity (0.0 to 1.0).
 * @param {boolean} isPlanet - Flag to distinguish between planet and moon structure.
 * @param {boolean} fadeLabel - Flag to control if the label should be faded.
 */
function applyFade(celestial, opacity, isPlanet = false, fadeLabel = true) {
    const mesh = isPlanet ? celestial.planet : (celestial.mesh || celestial);
    const orbit = isPlanet ? orbitRings.find(o => o.uuid === celestial.orbitRingUUID) : celestial.orbit;
    const label = celestial.label;

    // Fade the main mesh(es)
    if (mesh) {
        mesh.traverse(child => {
            // Don't fade Venus's permanent atmosphere
            if (child.isMesh && child.material && child.material.map !== planetTextures.venusAtmos) {
                child.material.opacity = opacity;
                child.material.transparent = opacity < 1.0;
            }
        });
    }

    // Fade the orbit line
    if (orbit && orbit.material) {
        orbit.material.opacity = opacity * (isPlanet ? 0.3 : 0.5);
    }

    // Fade the label
    if (fadeLabel && label && label.element) {
        label.element.style.opacity = opacity;
        // Make label clickable only when mostly visible
        label.element.style.pointerEvents = opacity > 0.5 ? 'auto' : 'none';
    }
}

/**
 * Updates the screen position of an HTML label based on a 3D world position.
 * @param {HTMLElement} labelElement - The HTML div element for the label.
 * @param {THREE.Vector3} worldPosition - The 3D position to track.
 */
function updateLabelPosition(labelElement, worldPosition) {
    const screenPosition = worldPosition.clone().project(camera);

    // Hide label if it's behind the camera
    if (screenPosition.z > 1) {
        labelElement.style.display = 'none';
        return;
    }
    labelElement.style.display = 'block';

    // Convert normalized device coordinates to screen coordinates
    const x = (screenPosition.x * 0.5 + 0.5) * renderer.domElement.clientWidth;
    const y = (screenPosition.y * -0.5 + 0.5) * renderer.domElement.clientHeight;

    labelElement.style.transform = `translate(-50%, -150%)`;
    labelElement.style.left = `${x}px`;
    labelElement.style.top = `${y}px`;
}

// 6. Animation Loop
// The animate function is called on every frame to update the scene.
function animate() {
    // Required for the animation loop
    requestAnimationFrame(animate);

    // --- Dynamic Intersectable Objects ---
    // Rebuild the list of clickable objects each frame based on visibility.
    // This prevents trying to click on objects that have been faded out.
    intersectableObjects = [];
    if (sun.material.opacity > 0.1) intersectableObjects.push(sun);
    planets.forEach(p => {
        if (p.planet.children[0].material.opacity > 0.1) {
            intersectableObjects.push(p.planet);
        }
    });
    stellarObjects.forEach(s => {
        if (s.mesh.material.opacity > 0.1) intersectableObjects.push(s.mesh);
    });

    if (!isAnimationPaused) {
        // Update moon positions (relative to their parent planet)
        moons.forEach(m => {
            m.theta += m.orbitSpeed * 0.1 * animationSpeed;
            const r = m.a * (1 - m.e * m.e) / (1 + m.e * Math.cos(m.theta));
            const pos = new THREE.Vector3(
                r * Math.cos(m.theta),
                0,
                r * Math.sin(m.theta)
            );

            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(m.i, m.lan, 0, 'YXZ'));
            pos.applyQuaternion(q);
            m.mesh.position.copy(pos);

            m.mesh.rotation.y += m.rotationSpeed * animationSpeed;
        });
    }


    if (!isAnimationPaused) {
        // Update planet positions for elliptical orbits
        planets.forEach(p => {
            p.theta += p.orbitSpeed * 0.1 * animationSpeed; // Control speed with slider

            // Calculate position using the polar equation for an ellipse
            const r = p.a * (1 - p.e * p.e) / (1 + p.e * Math.cos(p.theta));
            const pos = new THREE.Vector3(
                r * Math.cos(p.theta),
                0,
                r * Math.sin(p.theta)
            );

            // Apply inclination and longitude of ascending node
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.i, p.lan, 0, 'YXZ'));
            pos.applyQuaternion(q);
            p.planet.position.copy(pos);

            // For exoplanets, offset the position by their star's position
            const parentStar = stellarObjects.find(s => s.mesh.name === p.starName);
            if (parentStar) {
                p.planet.position.add(parentStar.mesh.position);
                // Also move the orbit ring to the star's position
                p.orbitRing.position.copy(parentStar.mesh.position);
            }

            // Planet's own rotation (around its Y-axis)
            p.planet.rotation.y += p.rotationSpeed * animationSpeed;
        });
    }

    // Update labels
    labels.forEach(label => {
        const worldPosition = new THREE.Vector3();
        label.object.getWorldPosition(worldPosition);

        // For the sun, offset the label position to be above the sphere's surface
        if (label.object.name === 'Sol') {
            const sunRadius = 1; // As defined in the sun's SphereGeometry
            worldPosition.y += sunRadius;
        }

        updateLabelPosition(label.element, worldPosition);
    });

    // Update distance counter
    let distanceToTarget = camera.position.distanceTo(controls.target);
    const kmPerAU = 149.6e6;
    const auPerLy = 63241.1;
    const lyPerPc = 3.26156;
    const pcPerKpc = 1000;

    // Smoothly interpolate distance for the UI
    // This is a placeholder for a more robust interpolation if needed.

    const distanceInAU = distanceToTarget / sceneUnitsPerAU;

    if (distanceInAU < 0.01) {
        const distanceInKm = distanceInAU * kmPerAU;
        distanceCounter.textContent = `Distance: ${distanceInKm.toLocaleString('en-US', { maximumFractionDigits: 0 })} km`;
    } else if (distanceInAU < auPerLy) {
        distanceCounter.textContent = `Distance: ${distanceInAU.toFixed(2)} AU`;
    } else if (distanceInAU < auPerLy * lyPerPc * pcPerKpc) {
        const distanceInLy = distanceInAU / auPerLy;
        distanceCounter.textContent = `Distance: ${distanceInLy.toFixed(2)} ly`;
    } else {
        const distanceInKpc = distanceInAU / auPerLy / lyPerPc / pcPerKpc;
        distanceCounter.textContent = `Distance: ${distanceInKpc.toLocaleString('en-US', { maximumFractionDigits: 2 })} kpc`;
    }

    // Update Scale Indicator UI
    scaleIndicator.textContent = `Scale: ${currentScale.charAt(0).toUpperCase() + currentScale.slice(1)}`;

    // --- Scale State Machine ---
    if (!autoZoom.active) {
        const isPlanetFocused = focusedObject && planetData.some(p => p.name === focusedObject.name);
        
        if (currentScale === 'system' && isPlanetFocused && distanceToTarget < SCALES.PLANET_TO_SYSTEM) {
            currentScale = 'planet';
        } else if (currentScale === 'planet' && (!isPlanetFocused || distanceToTarget > SCALES.PLANET_TO_SYSTEM * 1.2)) {
            currentScale = 'system';
        } else if (currentScale === 'system' && distanceInAU > SCALES.SYSTEM_TO_INTERSTELLAR * 1.2) { // Added a buffer to prevent flickering
            currentScale = 'interstellar';
        } else if (currentScale === 'interstellar' && distanceInAU < SCALES.SYSTEM_TO_INTERSTELLAR) {
            currentScale = 'system';
            // When zooming in from interstellar, just change the scale. Do not auto-zoom.
            // This prevents being locked into the Sol system when focusing on other stars.
        } else if (currentScale === 'interstellar' && distanceInAU > SCALES.INTERSTELLAR_TO_GALACTIC) {
            currentScale = 'galactic';
            const galacticViewDistLy = 100;
            const galacticViewDistScene = galacticViewDistLy * sceneUnitsPerLy;
            startAutoZoom(galacticViewDistScene, lastFocusedStarPosition);
        } else if (currentScale === 'galactic' && distanceInAU < SCALES.INTERSTELLAR_TO_GALACTIC) {
            currentScale = 'interstellar';
            startAutoZoom(SCALES.INTERSTELLAR_TO_GALACTIC * 0.8 * sceneUnitsPerAU);
        } else if (currentScale === 'planet' && !isPlanetFocused) {
            // If we are in planet view but lose focus on a planet, go back to system view
            currentScale = 'system';
        }
    }

    if (autoZoom.active) {
        const elapsedTime = performance.now() - autoZoom.startTime;
        let progress = Math.min(elapsedTime / autoZoom.duration, 1.0);
        // Ease-out cubic function for smooth deceleration
        progress = 1 - Math.pow(1 - progress, 3);

        camera.position.lerpVectors(autoZoom.startPos, autoZoom.endPos, progress);
        controls.target.lerpVectors(autoZoom.startTarget, autoZoom.endTarget, progress);

        if (progress >= 1.0) {
            autoZoom.active = false;
            autoZoomIndicator.style.display = 'none';
        }
    }

    // --- Cinematic Fading Logic ---
    const planetFade = THREE.MathUtils.smoothstep(distanceToTarget, SCALES.PLANET_TO_SYSTEM * 0.8, SCALES.PLANET_TO_SYSTEM);
    const systemFade = THREE.MathUtils.smoothstep(distanceInAU, SCALES.SYSTEM_TO_INTERSTELLAR * 0.8, SCALES.SYSTEM_TO_INTERSTELLAR);
    const interstellarFade = THREE.MathUtils.smoothstep(distanceInAU, SCALES.SYSTEM_TO_INTERSTELLAR, SCALES.INTERSTELLAR_TO_GALACTIC);

    // New fade logic specifically for planet labels based on a fixed AU distance.
    const planetLabelFade = THREE.MathUtils.smoothstep(distanceInAU, 450, 500);

    // --- Fading for Sol System vs Sol Sprite ---
    const solarSystemOpacity = 1.0 - systemFade;

    // Fade out the detailed sun mesh and its label
    sun.material.opacity = solarSystemOpacity;
    const solSystemLabel = labels.find(l => l.object === sun);
    if (solSystemLabel) {
        // Only show the system-scale label for Sol when not in interstellar view
        const isInterstellarView = currentScale === 'interstellar' || currentScale === 'galactic';
        const opacity = isInterstellarView ? 0 : solarSystemOpacity;
        solSystemLabel.element.style.opacity = opacity;
        solSystemLabel.element.style.pointerEvents = opacity > 0.5 ? 'auto' : 'none';
    }

    // Fade out solar system objects
    planets.forEach(p => {
        // Determine if the planet belongs to the currently focused system
        const isLocalPlanet = p.starName === lastFocusedSystem;
        const planetOpacity = isLocalPlanet ? solarSystemOpacity : 0;

        // We need to find the corresponding label for the planet
        p.label = labels.find(l => l.object === p.planet);
        // The planet mesh fades at the system scale. We pass 'false' to prevent applyFade from touching the label.
        applyFade(p, planetOpacity, true, false);
        // The planet label fades out much sooner, at 250 AU.
        const labelOpacity = 1.0 - planetLabelFade;
        if (p.label) p.label.element.style.opacity = isLocalPlanet ? labelOpacity : 0;
        if (p.label) p.label.element.style.pointerEvents = (isLocalPlanet && labelOpacity > 0.5) ? 'auto' : 'none';
    });

    // Fade in/out the system-scale star meshes
    starMeshes.forEach(mesh => {
        const isLocalStar = starSystems[lastFocusedSystem]?.stars.some(s => s.name === mesh.mesh.name);
        const opacity = isLocalStar ? solarSystemOpacity : 0;
        mesh.mesh.material.opacity = opacity;
        // Only show the system-scale label when not at interstellar/galactic scales
        if (currentScale !== 'interstellar' && currentScale !== 'galactic') {
            mesh.label.element.style.opacity = opacity;
        }
    });

    // Fade in/out the system-scale star lights
    starLights.forEach(light => {
        const isLocalStar = starSystems[lastFocusedSystem]?.stars.some(s => light.position.equals(s.position));
        light.visible = isLocalStar && solarSystemOpacity > 0.1;
    });

    // Fade in moon objects
    moons.forEach(m => {
        let moonOpacity = 0;
        // Only show moons if we are at planet scale and focused on their parent planet
        if (currentScale === 'planet' && focusedObject && m.mesh.parent && m.mesh.parent.name === focusedObject.name) {
            moonOpacity = 1.0 - planetFade;
        }
        applyFade(m, moonOpacity);
    });

    // Fade in stellar objects
    const interstellarOpacity = systemFade * (1.0 - interstellarFade); // Fade in, then out
    stellarObjects.forEach(s => {

        // At interstellar scale, hide individual star names and show the system name
        if (currentScale === 'interstellar' || currentScale === 'galactic') {
            if (s.label && s.label.element) {
                s.label.element.style.opacity = 0; // Hide individual star label
                s.label.element.style.pointerEvents = 'none';
            }
        } else { // At system or planet scale, fade the label with the star
            if (s.label && s.label.element) {
                s.label.element.style.opacity = 0;
                s.label.element.style.pointerEvents = 'none';
            }
        }
        s.mesh.material.opacity = interstellarOpacity; // Always fade the star mesh
    });

    // --- Z-Index Sorting for All Interstellar Labels ---
    const isInterstellarView = currentScale === 'interstellar' || currentScale === 'galactic';
    const allInterstellarLabels = [];

    // Add multi-star system labels
    Object.values(systemLabels).forEach(l => allInterstellarLabels.push({ element: l.element, position: l.position }));

    // Add single-star system labels (from their sprites)
    stellarObjects.forEach(s => {
        // Only add labels for single-star systems to avoid duplication with systemLabels
        if (s.label && !systemLabels[s.system]) {
            allInterstellarLabels.push({ element: s.label.element, position: s.mesh.position });
        }
    });

    // Sort all labels by distance to camera for correct z-index stacking
    const sortedLabels = allInterstellarLabels
        .map(label => ({ ...label, distance: camera.position.distanceTo(label.position) }))
        .sort((a, b) => b.distance - a.distance); // Farthest to closest

    sortedLabels.forEach((label, index) => {
        const opacity = isInterstellarView ? interstellarOpacity : 0;
        label.element.style.opacity = opacity;
        label.element.style.pointerEvents = (opacity > 0.5) ? 'auto' : 'none';
        label.element.style.zIndex = index; // Closer labels get a higher z-index
        updateLabelPosition(label.element, label.position);
    });

    starfield.material.opacity = interstellarOpacity;

    // Fade in galactic object
    galaxy.material.opacity = interstellarFade;

    // Hide system-scale star labels when in interstellar view to prevent duplicates
    if (isInterstellarView) {
        starMeshes.forEach(sm => sm.label.element.style.opacity = 0);
    }

    // Camera focusing logic
    if (focusedObject) {
        const targetPosition = new THREE.Vector3();
        focusedObject.getWorldPosition(targetPosition);
        controls.target.lerp(targetPosition, 0.05);

        // Update the last focused system
        const starData = starDatabase.find(s => s.name === focusedObject.name);
        if (starData) {
            lastFocusedSystem = starData.system;
            lastFocusedStarPosition.copy(targetPosition);
        } else if (focusedObject.name === 'Sol') {
            lastFocusedSystem = 'Sol';
            lastFocusedStarPosition.copy(targetPosition);
        }
    }

    // Required if controls.enableDamping is true
    controls.update();

    // Render the scene from the perspective of the camera
    renderer.render(scene, camera);
}

// 7. Resize Handler
// Ensures the scene resizes correctly when the browser window changes size.
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start the animation loop
animate();