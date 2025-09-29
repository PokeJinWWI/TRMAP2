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


// --- Global Scene Object Arrays ---
const planets = [];
const moons = [];
const orbitRings = [];
const labels = [];
const systemLabels = {}; // For multi-star system labels
const starMeshes = []; // For system-scale star meshes
const starLights = []; // For system-scale star lights
const starSystems = {}; // To hold system data like center position
let galaxyPointClouds = {}; // To hold the new 3D galaxy point clouds
const stellarObjects = []; // For nearby stars. Each element is { mesh, label, system }
let intersectableObjects = []; // Will be dynamically populated in the animation loop
let asteroidBelt; // To hold the asteroid belt group for animation
let galaxy;
let galaxyLabeled;
const pinnedObjects = new Set(); // To store the names of pinned objects
const searchableObjects = []; // Unified list for the search functionality

// --- Texture Loading ---
let planetTextures = {};
let miscTextures = {};

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
  {star: 'Sol', name:'Mercury', class: 'Terrestrial Planet', radius:0.38, distance: 35 * 0.39, eccentricity: 0.205, inclination: 7.00, lan: 48.3, axialTilt: 0.03, orbitSpeed:0.04, rotationSpeed:0.02, texture:'mercury', albedo: 0.14, parentStar: 'Sol'},
  {star: 'Sol', name:'Venus',   class: 'Terrestrial Planet', radius:0.95, distance: 35 * 0.72, eccentricity: 0.007, inclination: 3.39, lan: 76.7, axialTilt: 177.3, orbitSpeed:0.015, rotationSpeed:0.01, texture:'venus', albedo: 0.75, parentStar: 'Sol'},
  {star: 'Sol', name:'Earth',   class: 'Habitable World', radius:1,    distance: 35 * 1.00, eccentricity: 0.017, inclination: 0.00, lan: -11.2, axialTilt: 23.4, orbitSpeed:0.01, rotationSpeed:0.02, texture:'earth', albedo: 0.31, parentStar: 'Sol', moons: [
    { star: 'Sol', name: 'Luna', class: 'Rocky Moon', radius: 0.27, distance: 2.5, eccentricity: 0.054, inclination: 5.1, lan: 0, axialTilt: 6.7, orbitSpeed: 0.1, rotationSpeed: 0.01, texture: 'moon', albedo: 0.11, parentStar: 'Earth', system: 'Sol' }
  ]},
  {star: 'Sol', name:'Mars',    class: 'Terrestrial Planet', radius:0.53, distance: 35 * 1.52, eccentricity: 0.094, inclination: 1.85, lan: 49.6, axialTilt: 25.2, orbitSpeed:0.008, rotationSpeed:0.018, texture:'mars', albedo: 0.25, parentStar: 'Sol'},
  {star: 'Sol', name:'Jupiter', class: 'Gas Giant', radius:8.5,  distance: 35 * 5.20, eccentricity: 0.049, inclination: 1.31, lan: 100.5, axialTilt: 3.1, orbitSpeed:0.005, rotationSpeed:0.04, texture:'jupiter', albedo: 0.54, parentStar: 'Sol', moons: [
    { star: 'Sol', name: 'Io', class: 'Volcanic Moon', radius: 0.28, distance: 12, eccentricity: 0.004, inclination: 0.05, lan: 0, axialTilt: 0, orbitSpeed: 0.4, rotationSpeed: 0.1, texture: 'moon', albedo: 0.63, parentStar: 'Jupiter', system: 'Sol' },
    { star: 'Sol', name: 'Europa', class: 'Ice Moon', radius: 0.24, distance: 15, eccentricity: 0.009, inclination: 0.47, lan: 0, axialTilt: 0, orbitSpeed: 0.3, rotationSpeed: 0.08, texture: 'moon', albedo: 0.67, parentStar: 'Jupiter', system: 'Sol' },
    { star: 'Sol', name: 'Ganymede', class: 'Icy Moon', radius: 0.41, distance: 19, eccentricity: 0.001, inclination: 0.20, lan: 0, axialTilt: 0, orbitSpeed: 0.2, rotationSpeed: 0.05, texture: 'moon', albedo: 0.43, parentStar: 'Jupiter', system: 'Sol' },
    { star: 'Sol', name: 'Callisto', class: 'Rocky Moon', radius: 0.38, distance: 24, eccentricity: 0.007, inclination: 0.20, lan: 0, axialTilt: 0, orbitSpeed: 0.1, rotationSpeed: 0.03, texture: 'moon', albedo: 0.17, parentStar: 'Jupiter', system: 'Sol' }
  ]},
  {star: 'Sol', name:'Saturn',  class: 'Gas Giant', radius:7.5,  distance: 35 * 9.58, eccentricity: 0.057, inclination: 2.49, lan: 113.7, axialTilt: 26.7, orbitSpeed:0.003, rotationSpeed:0.038, texture:'saturn', albedo: 0.34, ring:true, parentStar: 'Sol'},
  {star: 'Sol', name:'Uranus',  class: 'Ice Giant', radius:3.5,  distance: 35 * 19.22, eccentricity: 0.046, inclination: 0.77, lan: 74.0, axialTilt: 97.8, orbitSpeed:0.002, rotationSpeed:0.03, texture:'uranus', albedo: 0.30, parentStar: 'Sol'},
  {star: 'Sol', name:'Neptune', class: 'Ice Giant', radius:3.3,  distance: 35 * 30.05, eccentricity: 0.011, inclination: 1.77, lan: 131.8, axialTilt: 28.3, orbitSpeed:0.0015, rotationSpeed:0.03, texture:'neptune', albedo: 0.29, parentStar: 'Sol'}
];

// Fictional exoplanet for Barnard's Star. Using existing textures as placeholders.
const exoplanetData = [
    // Data based on real, confirmed exoplanets. Distances are in AU.
    // Proxima Centauri System
    { star: "Alpha Centauri", name: "Proxima Centauri d", class: 'Hot Super-Earth', radius: 0.81, distance: 35 * 0.02885, eccentricity: 0.04, inclination: 133, lan: 149, axialTilt: 10.0, orbitSpeed: 0.25, rotationSpeed: 0.03, texture: 'mercury', albedo: 0.15, parentStar: 'Proxima Centauri' },
    { star: "Alpha Centauri", name: "Proxima Centauri b", class: 'Habitable Super-Earth', radius: 1.07, distance: 35 * 0.04857, eccentricity: 0.0, inclination: 133, lan: 149, axialTilt: 10.0, orbitSpeed: 0.18, rotationSpeed: 0.02, texture: 'mars', albedo: 0.20, parentStar: 'Proxima Centauri' }, // In habitable zone
    
    // Barnard's Star System
    { star: "Barnard's Star", name: "Barnard's Star b", class: 'Cold Super-Earth', radius: 1.3, distance: 35 * 0.404, eccentricity: 0.32, inclination: 90, lan: 120, axialTilt: 10.0, orbitSpeed: 0.02, rotationSpeed: 0.03, texture: 'uranus', albedo: 0.30, parentStar: "Barnard's Star" }, // A cold super-Earth

    // Epsilon Eridani System
    { star: "Epsilon Eridani", name: "Epsilon Eridani b", class: 'Gas Giant', radius: 8.0, distance: 35 * 3.48, eccentricity: 0.07, inclination: 34, lan: 11, axialTilt: 5.0, orbitSpeed: 0.006, rotationSpeed: 0.04, texture: 'jupiter', albedo: 0.50, parentStar: "Epsilon Eridani" },

    // Tau Ceti System
    { star: "Tau Ceti", name: "Tau Ceti g", class: 'Hot Super-Earth', radius: 1.1, distance: 35 * 0.133, eccentricity: 0.08, inclination: 35, lan: 188, axialTilt: 15.0, orbitSpeed: 0.1, rotationSpeed: 0.02, texture: 'venusSurface', albedo: 0.70, parentStar: "Tau Ceti" },
    { star: "Tau Ceti", name: "Tau Ceti h", class: 'Warm Super-Earth', radius: 1.1, distance: 35 * 0.243, eccentricity: 0.08, inclination: 35, lan: 188, axialTilt: 15.0, orbitSpeed: 0.07, rotationSpeed: 0.02, texture: 'earth', albedo: 0.35, parentStar: "Tau Ceti" },
    { star: "Tau Ceti", name: "Tau Ceti e", class: 'Habitable Super-Earth', radius: 1.5, distance: 35 * 0.538, eccentricity: 0.18, inclination: 35, lan: 188, axialTilt: 15.0, orbitSpeed: 0.04, rotationSpeed: 0.03, texture: 'mars', albedo: 0.25, parentStar: "Tau Ceti" }, // In habitable zone
    { star: "Tau Ceti", name: "Tau Ceti f", class: 'Cold Super-Earth', radius: 1.5, distance: 35 * 1.334, eccentricity: 0.16, inclination: 35, lan: 188, axialTilt: 15.0, orbitSpeed: 0.02, rotationSpeed: 0.03, texture: 'neptune', albedo: 0.30, parentStar: "Tau Ceti" }, // In habitable zone
];

// --- Interstellar Objects Data ---
const sceneUnitsPerAU = 35;
const auPerLy = 63241.1;
const sceneUnitsPerLy = sceneUnitsPerAU * auPerLy;

// Define Sol's position in the galaxy: ~27,000 light-years from the center.
// We'll place it along the positive Z-axis for this implementation.
const solGalacticPosition = new THREE.Vector3(0, 0, 27000 * sceneUnitsPerLy);

// Database of nearby stars
const starDatabase = [
    { system: "Alpha Centauri", name: "Alpha Centauri A", class: "G2V", radius: 1.22, dist: 4.37, ra: "14h 39m 36s", dec: "-60° 50' 02\"", color: 0xFFF4D5, scale: 48000 }, // G-type -> sun. Sprite scale reduced.
    { system: "Alpha Centauri", name: "Alpha Centauri B", class: "K1V", radius: 0.86, dist: 4.37, ra: "14h 39m 35s", dec: "-60° 50' 12\"", color: 0xFFD580, scale: 38000 }, // K-type -> orange. Sprite scale reduced.
    { system: "Alpha Centauri", name: "Proxima Centauri", class: "M5.5Ve", radius: 0.15, dist: 4.24, ra: "14h 29m 42s", dec: "-62° 40' 46\"", color: 0xFF8C61, scale: 15000 }, // M-type -> red
    { system: "Sirius", name: "Sirius A", class: "A1V", radius: 1.71, dist: 8.6, ra: "06h 45m 08s", dec: "-16° 42' 58\"", color: 0xcad7ff, scale: 65000 }, // A-type -> blue-white
    { system: "Sirius", name: "Sirius B", class: "DA2", radius: 0.008, dist: 8.6, ra: "06h 45m 08s", dec: "-16° 42' 58\"", color: 0xffffff, scale: 1000, isCompanion: true, companionDist: 30 }, // White Dwarf companion
    { system: "Barnard's Star", name: "Barnard's Star", class: "M4.0V", radius: 0.19, dist: 5.96, ra: "17h 57m 48s", dec: "+04° 41' 36\"", color: 0xFF9E6D, scale: 20000 }, // M-type -> red
    { system: "Wolf 359", name: "Wolf 359", class: "M6.5V", radius: 0.16, dist: 7.9, ra: "10h 56m 28s", dec: "+07° 00' 52\"", color: 0xC75A3A, scale: 16000 }, // M-type -> red
    { system: "Lalande 21185", name: "Lalande 21185", class: "M2.0V", radius: 0.39, dist: 8.31, ra: "11h 03m 20s", dec: "+35° 58' 11\"", color: 0xFFAD60, scale: 38000 }, // M-type -> red
    { system: "Luyten's Star", name: "Luyten's Star", class: "M3.5V", radius: 0.29, dist: 12.36, ra: "07h 27m 24s", dec: "+05° 13' 32\"", color: 0xFF9E6D, scale: 28000 }, // M-type -> red
    { system: "Epsilon Eridani", name: "Epsilon Eridani", class: "K2V", radius: 0.73, dist: 10.5, ra: "03h 32m 55s", dec: "-09° 27' 29\"", color: 0xFFD580, scale: 42000 }, // K-type -> orange
    { system: "Tau Ceti", name: "Tau Ceti", class: "G8.5V", radius: 0.79, dist: 11.9, ra: "01h 44m 04s", dec: "-15° 56' 14\"", color: 0xFFF0C9, scale: 48000 }, // G-type -> sun
];

// A scaling factor to make planets proportionally smaller than stars.
const planetScaleFactor = 0.1;

function createMoon(moonData, planetGroup) {
    const albedoColor = new THREE.Color().setScalar(moonData.albedo || 0.5);
    const moonMesh = new THREE.Mesh(
        new THREE.SphereGeometry(moonData.radius * planetScaleFactor, 16, 16),
        new THREE.MeshStandardMaterial({ map: planetTextures[moonData.texture], roughness: 0.7, transparent: true, opacity: 0, color: albedoColor })
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
    const planetGroup = new THREE.Group(); // This group will handle the planet's orbital position.
    planetGroup.name = data.name;

    const albedoColor = new THREE.Color().setScalar(data.albedo || 0.5);
    let surfaceMesh;

    if (data.name === 'Venus') {
        surfaceMesh = new THREE.Mesh(
            new THREE.SphereGeometry(data.radius * planetScaleFactor, 32, 32), // The actual planet mesh
            new THREE.MeshStandardMaterial({ map: planetTextures.venusSurface, roughness: 0.5, metalness: 0.1, color: albedoColor })
        );
        const atmosMesh = new THREE.Mesh(
            new THREE.SphereGeometry(data.radius * planetScaleFactor * 1.02, 32, 32), // The atmosphere mesh
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
            new THREE.SphereGeometry(data.radius * planetScaleFactor, 32, 32), // The actual planet mesh
            new THREE.MeshStandardMaterial({ map: planetTextures[data.texture], roughness: 0.5, metalness: 0.1, color: albedoColor })
        );
    }
    planetGroup.add(surfaceMesh); // Add the planet mesh to the main group.

    // Enable shadow casting and receiving for the main planet mesh
    // We traverse because for Venus, the surface is a child of the group.
    planetGroup.traverse(child => {
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
        surfaceMesh.add(ringMesh); // Add the ring to the rotating surface mesh, not the main group.
    }

    if (data.moons) {
        data.moons.forEach(moonData => {
            const moon = createMoon(moonData, planetGroup);
            // Add the moon's orbit as a child of the planet group
            // so it moves with the planet.
            planetGroup.add(moon.orbit);
        });
    }

    surfaceMesh.rotation.z = THREE.MathUtils.degToRad(data.axialTilt); // Apply axial tilt only to the surface mesh.
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
        opacity: 1.0, // Increased brightness
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

/**
 * A comprehensive function to create an entire star system from a data object.
 * It handles the creation of stars, planets, moons, orbits, and labels.
 * @param {object} systemData - An object containing the definition for the star system.
 */
function createStarSystem(systemData) {
    const systemName = systemData.name;
    const systemCenter = new THREE.Vector3();
    const starObjectsInSystem = [];

    // 1. Create the star(s) for the system
    systemData.stars.forEach(starData => {
        const starPosition = new THREE.Vector3();
        if (starData.ra && starData.dec && starData.dist > 0) {
            // Convert astronomical coordinates to Cartesian for interstellar stars
            const raParts = starData.ra.match(/(\d+)h (\d+)m (\d+)s/);
            const ra = (parseInt(raParts[1]) + parseInt(raParts[2])/60 + parseInt(raParts[3])/3600) * (15 * Math.PI/180);
            const decParts = starData.dec.match(/([+-])(\d+)° (\d+)' (\d+)"/);
            const decSign = decParts[1] === '-' ? -1 : 1;
            const dec = (parseInt(decParts[2]) + parseInt(decParts[3])/60 + parseInt(decParts[4])/3600) * (Math.PI/180) * decSign;
            const dist = starData.dist * sceneUnitsPerLy;
            starPosition.set(
                dist * Math.cos(dec) * Math.cos(ra),
                dist * Math.sin(dec),
                dist * Math.sin(ra)
            );
        }

        // If this star is a companion, offset its position from the system's primary star.
        // This is a simplified representation; a full orbital simulation would be more complex.
        if (starData.isCompanion) {
            starPosition.x += starData.companionDist || 20; // Default distance if not specified
        }

        // --- Create the system-scale star mesh (the large sphere) ---
        const spectralType = starData.class.charAt(0).toUpperCase();
        let systemStarTexture = planetTextures.sun;
        // Use specific textures for different star types
        if (starData.name === 'Sirius A') systemStarTexture = planetTextures.sun_blue;
        else if (starData.name === 'Sirius B') systemStarTexture = planetTextures.sun_white;
        else if (spectralType === 'A' || spectralType === 'B') systemStarTexture = planetTextures.sun_blue;
        else if (spectralType === 'K') systemStarTexture = planetTextures.sun_orange;
        else if (spectralType === 'M') systemStarTexture = planetTextures.sun_red;

        const starMesh = new THREE.Mesh(
            new THREE.SphereGeometry(starData.radius, 64, 64),
            new THREE.MeshBasicMaterial({ map: systemStarTexture, transparent: true, opacity: 0, depthWrite: false })
        );
        starMesh.position.copy(starPosition);
        starMesh.name = starData.name;
        scene.add(starMesh);
        const starMeshLabel = createLabel(starData.name, starMesh);
        labels.push(starMeshLabel);
        starMesh.label = starMeshLabel; // Attach label directly to the mesh object
        starMeshes.push(starMesh);

        // --- Create the interstellar star sprite ---
        let starSpriteTexture = planetTextures.star;
        // Use a blue texture for hot stars like A, B, and white dwarfs (D)
        if (starData.name === 'Sirius B') starSpriteTexture = planetTextures.sun_white;
        else if (spectralType === 'D') starSpriteTexture = planetTextures.sun_white; 
        else if (spectralType === 'A' || spectralType === 'B') starSpriteTexture = planetTextures.star_blue;


        const spriteMaterial = new THREE.SpriteMaterial({
            map: starSpriteTexture,
            color: starData.color,
            blending: THREE.AdditiveBlending,
            transparent: true,
            opacity: 0,
            depthWrite: false
        });
        const starSprite = new THREE.Sprite(spriteMaterial);
        starSprite.position.copy(starPosition);
        starSprite.scale.set(starData.scale * 10, starData.scale * 10, 1.0);
        starSprite.name = starData.name;
        scene.add(starSprite);
        const starSpriteLabel = createLabel(starData.name, starSprite);
        labels.push(starSpriteLabel);
        stellarObjects.push({ mesh: starSprite, label: starSpriteLabel, system: systemName });

        // --- Create the light source for the star ---
        const starLight = new THREE.PointLight(starData.color, 1.0);
        const basePower = 4 * Math.PI * 100000;
        starLight.power = basePower * (starData.radius ** 2);
        starLight.name = starData.name; // Assign name to the light for easier lookup
        starLight.decay = 2;
        starLight.position.copy(starPosition);
        starLight.visible = false;
        scene.add(starLight);
        starLights.push(starLight);

        // --- Add to searchable objects and system tracking ---
        searchableObjects.push({ name: starData.name, type: 'star', object: starSprite });
        starObjectsInSystem.push(starSprite);
        systemCenter.add(starPosition);
    });

    // Finalize system registration
    systemCenter.divideScalar(systemData.stars.length);
    starSystems[systemName] = { stars: starObjectsInSystem, center: systemCenter };
    if (systemData.stars.length > 1) {
        createSystemLabel(systemName, systemCenter);
    }

    // 2. Create the planets for the system
    if (systemData.planets) {
        systemData.planets.forEach(planetData => {
            const planetObject = createCelestialObject(planetData);
            scene.add(planetObject);

            const orbitRing = createOrbit(planetData.distance, planetData.eccentricity, THREE.MathUtils.degToRad(planetData.inclination), THREE.MathUtils.degToRad(planetData.lan));
            scene.add(orbitRing);
            // Store the UUID to link the ring to the planet later
            planetObject.orbitRingUUID = orbitRing.uuid;
            orbitRings.push({
                ring: orbitRing,
                starName: systemName, // Associate orbit with its star system
                parentStar: planetData.parentStar
            });

            // If this is our special ghost object, make its mesh invisible and skip UI creation.
            if (planetData.name !== 'Mercury Ghost') {
                labels.push(createLabel(planetData.name, planetObject));
                searchableObjects.push({ name: planetData.name, type: 'planet', object: planetObject });
            } else {
                planetObject.visible = false; // Make the planet mesh invisible
            }


            planets.push({
                starName: systemName,
                parentStar: planetData.parentStar,
                planet: planetObject,
                a: planetData.distance,
                e: planetData.eccentricity,
                i: THREE.MathUtils.degToRad(planetData.inclination),
                lan: THREE.MathUtils.degToRad(planetData.lan),
                orbitSpeed: planetData.orbitSpeed,
                rotationSpeed: planetData.rotationSpeed,
                theta: Math.random() * 2 * Math.PI,
                orbitRing: orbitRing // Keep this for now for compatibility, but UUID is better
            });
        });
    }
}

// --- System Definitions ---

const solSystemData = {
    name: 'Sol',
    stars: [ // Note: dist, ra, dec are ignored for Sol; its position is handled specially.
        { name: 'Sol', class: 'G2V', radius: 1.0, dist: 0, color: 0xFFF4D5, scale: 50000 }
    ],
    planets: [
        { star: 'Sol', name:'Mercury', class: 'Barren World', radius:0.38, distance: 35 * 0.39, eccentricity: 0.205, inclination: 7.00, lan: 48.3, axialTilt: 0.03, orbitSpeed:0.04, rotationSpeed:0.02, texture:'mercury', albedo: 0.14, parentStar: 'Sol'},
        { star: 'Sol', name:'Mercury Ghost', class: 'Barren World', radius:0.38, distance: 35 * 0.39, eccentricity: 0.205, inclination: 7.00, lan: 48.3, axialTilt: 0.03, orbitSpeed:0.04, rotationSpeed:0.02, texture:'mercury', albedo: 0.14, parentStar: 'Sol'},
        { star: 'Sol', name:'Venus',   class: 'Hothouse World', radius:0.95, distance: 35 * 0.72, eccentricity: 0.007, inclination: 3.39, lan: 76.7, axialTilt: 177.3, orbitSpeed:0.015, rotationSpeed:0.01, texture:'venus', albedo: 0.75, parentStar: 'Sol'},
        { star: 'Sol', name:'Earth',   class: 'Continental World', radius:1,    distance: 35 * 1.00, eccentricity: 0.017, inclination: 0.00, lan: -11.2, axialTilt: 23.4, orbitSpeed:0.01, rotationSpeed:0.02, texture:'earth', albedo: 0.31, parentStar: 'Sol', moons: [
            { star: 'Sol', system: 'Sol', name: 'Luna', radius: 0.27, distance: 2.5, eccentricity: 0.054, inclination: 5.1, lan: 0, axialTilt: 6.7, orbitSpeed: 0.1, rotationSpeed: 0.01, texture: 'moon', albedo: 0.11, parentStar: 'Earth' }
        ]},
        { star: 'Sol', name:'Mars',    class: 'Desert World', radius:0.53, distance: 35 * 1.52, eccentricity: 0.094, inclination: 1.85, lan: 49.6, axialTilt: 25.2, orbitSpeed:0.008, rotationSpeed:0.018, texture:'mars', albedo: 0.25, parentStar: 'Sol'},
        { star: 'Sol', name:'Jupiter', class: 'Gas Giant', radius:8.5,  distance: 35 * 5.20, eccentricity: 0.049, inclination: 1.31, lan: 100.5, axialTilt: 3.1, orbitSpeed:0.005, rotationSpeed:0.04, texture:'jupiter', albedo: 0.54, parentStar: 'Sol', moons: [
            { star: 'Sol', system: 'Sol', name: 'Io', class: 'Volcanic Moon', radius: 0.28, distance: 12, eccentricity: 0.004, inclination: 0.05, lan: 0, axialTilt: 0, orbitSpeed: 0.4, rotationSpeed: 0.1, texture: 'moon', albedo: 0.63, parentStar: 'Jupiter' },
            { star: 'Sol', system: 'Sol', name: 'Europa', class: 'Ice Moon', radius: 0.24, distance: 15, eccentricity: 0.009, inclination: 0.47, lan: 0, axialTilt: 0, orbitSpeed: 0.3, rotationSpeed: 0.08, texture: 'moon', albedo: 0.67, parentStar: 'Jupiter' },
            { star: 'Sol', system: 'Sol', name: 'Ganymede', class: 'Icy Moon', radius: 0.41, distance: 19, eccentricity: 0.001, inclination: 0.20, lan: 0, axialTilt: 0, orbitSpeed: 0.2, rotationSpeed: 0.05, texture: 'moon', albedo: 0.43, parentStar: 'Jupiter' },
            { star: 'Sol', system: 'Sol', name: 'Callisto', class: 'Rocky Moon', radius: 0.38, distance: 24, eccentricity: 0.007, inclination: 0.20, lan: 0, axialTilt: 0, orbitSpeed: 0.1, rotationSpeed: 0.03, texture: 'moon', albedo: 0.17, parentStar: 'Jupiter' }
        ]},
        { star: 'Sol', name:'Saturn',  class: 'Gas Giant', radius:7.5,  distance: 35 * 9.58, eccentricity: 0.057, inclination: 2.49, lan: 113.7, axialTilt: 26.7, orbitSpeed:0.003, rotationSpeed:0.038, texture:'saturn', albedo: 0.34, ring:true, parentStar: 'Sol'},
        { star: 'Sol', name:'Uranus',  class: 'Ice Giant', radius:3.5,  distance: 35 * 19.22, eccentricity: 0.046, inclination: 0.77, lan: 74.0, axialTilt: 97.8, orbitSpeed:0.002, rotationSpeed:0.03, texture:'uranus', albedo: 0.30, parentStar: 'Sol'},
        { star: 'Sol', name:'Neptune', class: 'Ice Giant', radius:3.3,  distance: 35 * 30.05, eccentricity: 0.011, inclination: 1.77, lan: 131.8, axialTilt: 28.3, orbitSpeed:0.0015, rotationSpeed:0.03, texture:'neptune', albedo: 0.29, parentStar: 'Sol'}
    ]
};

const solMoons = solSystemData.planets.flatMap(p => p.moons || []);
const allPlanetData = [...solSystemData.planets, ...solMoons, ...exoplanetData];

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

// Group all stars and planets from the databases into a unified system structure.
const allSystems = {};

// First, add all stars from the database, grouping them by system.
starDatabase.forEach(p => {
    if (!allSystems[p.system]) allSystems[p.system] = { name: p.system, stars: [], planets: [] };
    allSystems[p.system].stars.push(p);
});

// Next, add all exoplanets to their respective systems.
exoplanetData.forEach(p => {
    // Find the star's full data to get its parent system name.
    const starInfo = starDatabase.find(s => s.name === p.star);
    const systemName = starInfo ? starInfo.system : p.star;

    if (!allSystems[systemName]) allSystems[systemName] = { name: systemName, stars: [], planets: [] };
    allSystems[systemName].planets.push(p);
});

const asteroidBeltUniforms = {
    u_time: { value: 0.0 },
    u_wobble: { value: 0.4 }, // Increased distortion for a more "potato" shape
    u_visibility: { value: 1.0 } // Uniform to control visibility from JS
};

function createAsteroidBelt() {
    const asteroidCount = 5000;
    const innerRadius = 35 * 2.1; // ~2.1 AU
    const outerRadius = 35 * 3.3; // ~3.3 AU
    const beltHeight = 5; // How thick the belt is vertically

    const geometry = new THREE.IcosahedronGeometry(0.1, 1); // Increased detail for a more rounded base shape

    // Per-instance data buffers
    const orbitData = new Float32Array(asteroidCount * 4); // radius, speed, initialAngle, yOffset
    const transformData = new Float32Array(asteroidCount * 4); // 3 for rotation axis, 1 for rotation speed (tumbling)
    const scaleData = new Float32Array(asteroidCount * 3); // non-uniform scale (x, y, z)

    const material = new THREE.MeshBasicMaterial({
        map: miscTextures.asteroid, // Use a basic material that is not affected by lights
        color: 0xffffff // Ensure the texture is not tinted
    });

    for (let i = 0; i < asteroidCount; i++) {
        const radius = THREE.MathUtils.randFloat(innerRadius, outerRadius);
        const initialAngle = Math.random() * 2 * Math.PI;
        // Kepler's Third Law approximation: speed is inversely proportional to sqrt(radius)
        const speed = Math.sqrt(1 / radius) * 0.5; // Increased speed multiplier for more visible variation
        const yOffset = THREE.MathUtils.randFloatSpread(beltHeight);

        orbitData[i * 4 + 0] = radius;
        orbitData[i * 4 + 1] = speed;
        orbitData[i * 4 + 2] = initialAngle;
        orbitData[i * 4 + 3] = yOffset;

        // Random rotation axis and speed for tumbling effect
        const rotationAxis = new THREE.Vector3().randomDirection();
        const rotationSpeed = THREE.MathUtils.randFloat(0.1, 0.5);
        transformData[i * 4 + 0] = rotationAxis.x;
        transformData[i * 4 + 1] = rotationAxis.y;
        transformData[i * 4 + 2] = rotationAxis.z;
        transformData[i * 4 + 3] = rotationSpeed;

        // Random non-uniform scale for a "potato" shape
        const baseScale = THREE.MathUtils.randFloat(0.5, 1.5);
        scaleData[i * 3 + 0] = baseScale * THREE.MathUtils.randFloat(1.0, 2.5); // Elongate on X
        scaleData[i * 3 + 1] = baseScale * THREE.MathUtils.randFloat(0.7, 1.2);
        scaleData[i * 3 + 2] = baseScale * THREE.MathUtils.randFloat(0.7, 1.2);
    }

    geometry.setAttribute('a_orbitData', new THREE.InstancedBufferAttribute(orbitData, 4));
    geometry.setAttribute('a_transformData', new THREE.InstancedBufferAttribute(transformData, 4));
    geometry.setAttribute('a_scale', new THREE.InstancedBufferAttribute(scaleData, 3));

    // The onBeforeCompile logic is no longer needed for MeshBasicMaterial,
    // but we keep the position calculation part.
    material.onBeforeCompile = shader => {
        // Pass our custom uniforms to the shader
        shader.uniforms.u_time = asteroidBeltUniforms.u_time;
        shader.uniforms.u_wobble = asteroidBeltUniforms.u_wobble; // Not used, but kept for potential future use
        shader.uniforms.u_visibility = asteroidBeltUniforms.u_visibility;

        // Add attributes and uniforms to the vertex shader
        shader.vertexShader = `
            uniform float u_time;
            // uniform float u_wobble; // This uniform is not currently used in the shader.
            uniform float u_visibility;

            attribute vec4 a_orbitData;
            attribute vec4 a_transformData;
            attribute vec3 a_scale;

            // Declare rotation matrices at a higher scope so they can be shared
            // between the vertex position and normal calculation steps.
            mat4 instanceRotation;
            mat4 orbitalRotation;

        ` + shader.vertexShader;

        // We still need the rotation matrix function for the position calculation.
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `
            #include <common>
            mat4 rotationMatrix(vec3 axis, float angle) {
                axis = normalize(axis);
                float s = sin(angle);
                float c = cos(angle);
                float oc = 1.0 - c;
                return mat4(oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,  0.0,
                            oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,  0.0,
                            oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c,           0.0,
                            0.0,                                0.0,                                0.0,                                1.0);
            }`);
        // Inject a single block of code to handle all instance-specific calculations.
        // This ensures all variables are calculated in the correct order before use.
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
                // --- Instance-specific Orbital and Rotational Calculations ---

                float radius = a_orbitData.x;
                float speed = a_orbitData.y;
                float initialAngle = a_orbitData.z;
                float yOffset = a_orbitData.w;
 
                // 1. Calculate tumbling rotation
                vec3 rotationAxis = a_transformData.xyz;
                float rotationSpeed = a_transformData.w;
                float rotationAngle = u_time * rotationSpeed;
                instanceRotation = rotationMatrix(rotationAxis, rotationAngle);

                // 2. Calculate orbital position and alignment
                float currentAngle = initialAngle + u_time * speed;
                vec3 orbitalPosition = vec3(radius * cos(currentAngle), yOffset, radius * sin(currentAngle));
                vec3 orbitalTangent = normalize(vec3(-radius * sin(currentAngle), 0.0, radius * cos(currentAngle)));
                vec3 up = vec3(0.0, 1.0, 0.0);
                vec3 orbitalBinormal = normalize(cross(orbitalTangent, up));
                vec3 orbitalNormal = normalize(cross(orbitalBinormal, orbitalTangent));
                orbitalRotation = mat4(vec4(orbitalTangent, 0.0), vec4(orbitalNormal, 0.0), vec4(orbitalBinormal, 0.0), vec4(0.0, 0.0, 0.0, 1.0));
 
                // 3. Apply transformations to the vertex position
                vec3 transformed = ((orbitalRotation * instanceRotation * vec4(position * a_scale, 1.0)).xyz + orbitalPosition) * u_visibility;
            `);
    };

    const instancedMesh = new THREE.InstancedMesh(geometry, material, asteroidCount);
    instancedMesh.castShadow = false; // Performance: asteroids don't need to cast shadows
    instancedMesh.receiveShadow = false; // Performance: asteroids don't need to receive shadows
// Disable frustum culling for the entire belt. This prevents the whole InstancedMesh
    // from disappearing when the camera is inside the belt and the object's bounding
    // sphere is no longer in the camera's view.
    instancedMesh.frustumCulled = false;

    // The belt itself doesn't need a name for raycasting, as we won't be clicking individual asteroids.
    scene.add(instancedMesh);
    return instancedMesh;
}

// Create and store the asteroid belt
asteroidBelt = createAsteroidBelt();


/**
 * Creates a volumetric 3D galaxy from point clouds, based on the density of a texture.
 * This is a simplified version of what's needed for a full "100,000 Stars" effect.
 */
function createVolumetricGalaxy() {
    const thinDiskStars = 100000;
    const thickDiskStars = 50000;
    const galaxyBulgeStars = 50000;
    const galaxyHaloStars = 1000; // Reduced for a sparser halo

    const galaxySize = 100000 * sceneUnitsPerLy; // 100k light-year diameter (unchanged)
    const thinDiskThickness = 800 * sceneUnitsPerLy;
    const thickDiskThickness = 3000 * sceneUnitsPerLy;

    // --- Create a canvas to sample the galaxy texture for density mapping ---
    const densityMapCanvas = document.createElement('canvas');
    const densityMapCtx = densityMapCanvas.getContext('2d', { willReadFrequently: true });
    const galaxyImage = planetTextures.galaxy.image;
    densityMapCanvas.width = galaxyImage.width;
    densityMapCanvas.height = galaxyImage.height;
    densityMapCtx.drawImage(galaxyImage, 0, 0);
    const densityMapData = densityMapCtx.getImageData(0, 0, densityMapCanvas.width, densityMapCanvas.height).data;

    // --- 1. Thin Disk (Young Stars in Spiral Arms) ---
    const thinDiskVertices = [];
    while (thinDiskVertices.length < thinDiskStars * 3) {
        const r = Math.random() * galaxySize / 2;
        const angle = Math.random() * 2 * Math.PI;
        const x = r * Math.cos(angle);
        const z = r * Math.sin(angle);

        // Map world coordinates to texture UV coordinates
        const u = (x / galaxySize) + 0.5;
        const v = (z / galaxySize) + 0.5;

        // Get pixel brightness from the density map
        const tx = Math.floor(u * densityMapCanvas.width);
        const ty = Math.floor(v * densityMapCanvas.height);
        const pixelIndex = (ty * densityMapCanvas.width + tx) * 4;
        const brightness = densityMapData[pixelIndex] / 255; // Use the red channel for brightness

        // Rejection sampling: only place a star if a random value is less than the pixel's brightness.
        // Squaring the brightness makes the contrast much higher, heavily depopulating darker areas.
        if (Math.random() > Math.pow(brightness, 2)) continue; // Skip this star if it's in a dark area.

        const scaleHeight = thinDiskThickness * Math.exp(-r / (galaxySize / 5));
        const y = -Math.log(1 - Math.random()) * scaleHeight * (Math.random() < 0.5 ? 1 : -1);
        thinDiskVertices.push(x, y, z);
    }
    const thinDiskGeometry = new THREE.BufferGeometry();
    thinDiskGeometry.setAttribute('position', new THREE.Float32BufferAttribute(thinDiskVertices, 3));
    const thinDiskMaterial = new THREE.PointsMaterial({
        color: 0xD0E0FF, // Brighter, bluer for young stars
        size: 15000, // Adjust size for visibility at galactic scale
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const thinDiskPoints = new THREE.Points(thinDiskGeometry, thinDiskMaterial);
    scene.add(thinDiskPoints);

    // --- 2. Thick Disk (Older, more dispersed stars) ---
    const thickDiskVertices = [];
    while (thickDiskVertices.length < thickDiskStars * 3) {
        const r = Math.random() * galaxySize / 2;
        const angle = Math.random() * 2 * Math.PI;
        const x = r * Math.cos(angle);
        const z = r * Math.sin(angle);

        // Also apply density mapping to the thick disk, but less strictly.
        const u = (x / galaxySize) + 0.5;
        const v = (z / galaxySize) + 0.5;
        const tx = Math.floor(u * densityMapCanvas.width);
        const ty = Math.floor(v * densityMapCanvas.height);
        const pixelIndex = (ty * densityMapCanvas.width + tx) * 4;
        const brightness = densityMapData[pixelIndex] / 255;

        // Use a less aggressive rejection sampling (sqrt) so the thick disk is more diffuse
        // but still respects the dark lanes.
        if (Math.random() > Math.sqrt(brightness)) continue;

        const scaleHeight = thickDiskThickness * Math.exp(-r / (galaxySize / 4)); const y = -Math.log(1 - Math.random()) * scaleHeight * (Math.random() < 0.5 ? 1 : -1);
        thickDiskVertices.push(x, y, z);
    }
    const thickDiskGeometry = new THREE.BufferGeometry();
    thickDiskGeometry.setAttribute('position', new THREE.Float32BufferAttribute(thickDiskVertices, 3));
    const thickDiskMaterial = new THREE.PointsMaterial({
        color: 0xFFF0D9, // Warmer for older stars
        size: 12000,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const thickDiskPoints = new THREE.Points(thickDiskGeometry, thickDiskMaterial);
    scene.add(thickDiskPoints);

    // --- 3. Galaxy Bulge (Central Core) ---
    const bulgeVertices = [];
    const bulgeStdDev = 4000 * sceneUnitsPerLy; // Standard deviation for the Gaussian distribution

    // Helper function for generating normally distributed random numbers (Box-Muller transform)
    const gaussianRandom = () => {
        const u = 1 - Math.random(); // (0, 1]
        const v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    };

    for (let i = 0; i < galaxyBulgeStars; i++) {
        // Generate positions using a Gaussian distribution for a smooth falloff from the center.
        const x = gaussianRandom() * bulgeStdDev;
        const y = gaussianRandom() * bulgeStdDev * 0.5625; // The bulge is now 0.75x as tall
        const z = gaussianRandom() * bulgeStdDev;
        bulgeVertices.push(x, y, z);
    }

    const bulgeGeometry = new THREE.BufferGeometry();
    bulgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bulgeVertices, 3));
    const bulgeMaterial = new THREE.PointsMaterial({
        color: 0xFFE082, // A richer, more golden-yellow for the core
        size: 25000,     // Increased size for a brighter appearance
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const bulgePoints = new THREE.Points(bulgeGeometry, bulgeMaterial);
    scene.add(bulgePoints);

    // --- 4. Galaxy Halo ---
    const haloVertices = [];
    const haloRadius = 120000 * sceneUnitsPerLy; // Reduced radius for a smaller halo
    for (let i = 0; i < galaxyHaloStars; i++) {
        const u = Math.random();
        const v = Math.random();
        const theta = Math.random() * 2 * Math.PI;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = haloRadius * Math.cbrt(Math.random());
        const x = r * Math.sin(phi) * Math.cos(theta); const y = r * Math.sin(phi) * Math.sin(theta); const z = r * Math.cos(phi);
        haloVertices.push(x, y, z);
    }
    const haloGeometry = new THREE.BufferGeometry();
    haloGeometry.setAttribute('position', new THREE.Float32BufferAttribute(haloVertices, 3));
    const haloMaterial = new THREE.PointsMaterial({
        color: 0xCAD7FF, // Cooler color for halo stars
        size: 15000, // Reduced size to make stars less prominent
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const haloPoints = new THREE.Points(haloGeometry, haloMaterial);
    scene.add(haloPoints);

    return { thinDisk: thinDiskPoints, thickDisk: thickDiskPoints, bulge: bulgePoints, halo: haloPoints };
}

function createGalaxyMeshes() {
    const galaxySize = sceneUnitsPerLy * 100000; // 100k light-year diameter
    // Create the geometry in the XZ plane directly so it matches the volumetric galaxy.
    const geometry = new THREE.PlaneGeometry(galaxySize, galaxySize, 1, 1);
    geometry.rotateX(-Math.PI / 2);

    const createMaterial = (texture) => new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide // Render both sides
    });

    const galaxyMesh = new THREE.Mesh(geometry, createMaterial(planetTextures.galaxy));
    scene.add(galaxyMesh);

    const galaxyLabeledMesh = new THREE.Mesh(geometry, createMaterial(planetTextures.galaxy_labeled));
    scene.add(galaxyLabeledMesh);

    return { galaxy: galaxyMesh, galaxyLabeled: galaxyLabeledMesh };
}

// --- Font Loading for 3D Text (Placeholder for future use if needed) ---
// const fontLoader = new FontLoader();
// fontLoader.load('fonts/Conthrax_Regular.json', (font) => {
//     // You can create 3D text geometry here
// });

// --- UI Controls ---
const uiContainer = document.getElementById('ui-container');
const uiToggleButton = document.getElementById('ui-toggle-button');

uiToggleButton.addEventListener('click', () => {
    const isCollapsed = uiContainer.classList.toggle('collapsed');
    // Change the arrow direction based on the collapsed state
    uiToggleButton.innerHTML = isCollapsed ? '&raquo;' : '&laquo;';
});


const showOrbitsCheckbox = document.getElementById('show-orbits-checkbox');
showOrbitsCheckbox.addEventListener('change', (e) => {
    const isVisible = e.target.checked;
    orbitRings.forEach(ring => {
        ring.ring.visible = isVisible;
    });
    // Also toggle the visibility of all moon orbits
    moons.forEach(moon => {
        if (moon.orbit) moon.orbit.visible = isVisible;
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

const showGalaxyDiagramCheckbox = document.getElementById('show-galaxy-diagram-checkbox');
showGalaxyDiagramCheckbox.addEventListener('change', () => {
    // The actual fade logic is handled in the animate loop
});

const showAsteroidsCheckbox = document.getElementById('show-asteroids-checkbox');
showAsteroidsCheckbox.addEventListener('change', (e) => {
    if (asteroidBelt) {
        asteroidBelt.visible = e.target.checked;
    }
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

// --- Raycasting and Focusing ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let focusedObject = null;
let previousFocusedObject = null; // To track changes in focus

// --- Drag detection to prevent click-after-drag issues ---
let isDragging = false;
let mouseDownPos = new THREE.Vector2();

let cameraTransition = {
    active: false,
    startTime: 0,
    duration: 1500, // 1.5 seconds for a smooth glide
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3()
};

window.addEventListener('mousedown', (e) => {
    isDragging = false;
    mouseDownPos.set(e.clientX, e.clientY);
});
window.addEventListener('mousemove', (e) => {
    // If the mouse moves more than a few pixels, consider it a drag.
    if (mouseDownPos.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 5) isDragging = true;
});

const infoBox = document.getElementById('info-box');
const infoName = document.getElementById('info-name');
const infoDetails = document.getElementById('info-details');
const pinButton = document.getElementById('pin-button');
const lockCameraCheckbox = document.getElementById('lock-camera-checkbox');

function onMouseClick(event) {
    // If the click originated from one of the UI containers, ignore it.
    // This prevents clicks on UI elements from being interpreted as clicks on the 3D scene.

    // If the user was dragging (rotating the camera), don't process this click event
    // for focusing/defocusing, as it's the end of a drag, not a selection click.
    if (isDragging) {
        return;
    }
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

            // If not in lock mode, start a smooth camera transition
            if (!lockCameraCheckbox.checked) {
                cameraTransition.active = true;
                cameraTransition.startTime = performance.now();
                cameraTransition.startPos.copy(camera.position);
                cameraTransition.startTarget.copy(controls.target);

                const newTargetPos = new THREE.Vector3();
                clickedObject.getWorldPosition(newTargetPos);
                cameraTransition.endTarget.copy(newTargetPos);

                cameraTransition.endPos.copy(camera.position).sub(controls.target).add(newTargetPos);
            }
        }
    } else {
        // Clicked on empty space, unfocus
        focusedObject = null;
    }
    
    updateInfoPanel();
}

// Cancel any active camera transition if the user interacts with the controls.
controls.addEventListener('start', () => {
    cameraTransition.active = false;
});


function updateInfoPanel() {
    if (!focusedObject) {
        infoBox.style.display = 'none';
        pinButton.style.display = 'none';
        lockCameraCheckbox.style.display = 'none';
        return;
    }

    let data = allPlanetData.find(p => p.name === focusedObject.name);
    const starData = starDatabase.find(s => s.name === focusedObject.name);
    let moonData = null;
    let parentPlanetData = null;

    // Search for moon data if no planet or star was found
    if (!data && !starData) {
        for (const planet of solSystemData.planets) { // Search within the original nested structure
            const foundMoon = planet.moons?.find(m => m.name === focusedObject.name);
            if (foundMoon) { moonData = foundMoon; parentPlanetData = planet; break; }
        }
        if (moonData) data = moonData; // Treat found moon as the main data object
    }

    if (focusedObject.name === 'Sol') {
        infoName.textContent = 'Sol'; // This is a special case, handled like a star
        infoDetails.innerHTML = `Type: Yellow Dwarf (G2V)<br>System: Sol<br>Radius: 696,340 km`;
    } else if (data) {
        infoName.textContent = data.name;
        const earthRadiusKm = 6371;
        const planetRadiusKm = data.radius * earthRadiusKm;
        infoDetails.innerHTML = `Type: ${data.class || (data.parentStar.includes('Sol') ? 'Planet' : 'Moon')}<br>System: ${data.system || data.star}<br>Parent Body: ${data.parentStar}<br>Radius: ${planetRadiusKm.toLocaleString()} km (${data.radius}x Earth)`;
    } else if (starData) { // Check for star data
        infoName.textContent = starData.name;
        const sunRadiusKm = 696340;
        const starRadiusKm = starData.radius * sunRadiusKm;
        const starTypeName = getStarTypeName(starData.class);
        infoDetails.innerHTML = `Type: ${starTypeName} (${starData.class})<br>System: ${starData.system}<br>Radius: ${starRadiusKm.toLocaleString()} km (${starData.radius}x Sol)<br>Distance from Sol: ${starData.dist} light-years`;
    } else {
        infoBox.style.display = 'none';
        pinButton.style.display = 'none';
        return;
    }

    // If we have valid data, show the info box and configure the pin button
    if (infoName.textContent) {
        infoBox.style.display = 'block';
        pinButton.style.display = 'inline-block';
        lockCameraCheckbox.style.display = 'inline-block';
        pinButton.textContent = pinnedObjects.has(focusedObject.name) ? 'Unpin' : 'Pin';
    } else {
        infoBox.style.display = 'none';
        lockCameraCheckbox.style.display = 'none';
        pinButton.style.display = 'none';
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
        case 'D': return 'White Dwarf';
        case 'L':
        case 'T':
        case 'Y': return 'Brown Dwarf';
        default: return 'Star';
    }
}

const pinnedItemsDropdown = document.getElementById('pinned-items-dropdown');
const pinnedItemsButton = document.getElementById('pinned-items-button');
const pinnedItemsList = document.getElementById('pinned-items-list');

function updatePinnedItemsList() {
    pinnedItemsList.innerHTML = ''; // Clear the list
    const count = pinnedObjects.size;
    pinnedItemsButton.textContent = `Pinned Items (${count})`;

    if (count === 0) {
        pinnedItemsDropdown.style.display = 'none';
        return;
    }

    pinnedItemsDropdown.style.display = 'block';

    pinnedObjects.forEach(name => { // The 'name' here is the object's name string
        const itemDiv = document.createElement('div');
        itemDiv.className = 'pinned-item';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;
        nameSpan.addEventListener('click', () => {
            // Find the object by name from our searchable list and focus it
            const item = searchableObjects.find(o => o.name === name);
            if (item && item.object) {
                focusedObject = item.object;
                updateInfoPanel();
            }
        });

        const unpinBtn = document.createElement('button');
        unpinBtn.innerHTML = '&times;'; // Use a multiplication sign for the 'x'
        unpinBtn.className = 'unpin-button';
        unpinBtn.title = `Unpin ${name}`;
        unpinBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            pinnedObjects.delete(name);
            updatePinnedItemsList(); // Refresh the pinned list UI
            updateInfoPanel(); // Refresh the main pin button if the currently focused object was unpinned
        });

        itemDiv.appendChild(nameSpan);
        itemDiv.appendChild(unpinBtn);
        pinnedItemsList.appendChild(itemDiv);
    });
}

pinnedItemsButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const isVisible = pinnedItemsList.style.display === 'block';
    pinnedItemsList.style.display = isVisible ? 'none' : 'block';
});

// Hide pinned items list when clicking elsewhere
window.addEventListener('click', (event) => {
    // Check if the click was outside the dropdown container
    if (!event.target.closest('#pinned-items-dropdown')) {
        pinnedItemsList.style.display = 'none';
    }
});

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

                // If we are in a system and select an object in a DIFFERENT system,
                // immediately switch to interstellar view.
                const planetInfo = allPlanetData.find(p => p.name === item.name); // This uses the combined data
                if (planetInfo && planetInfo.star !== lastFocusedSystem) {
                    currentScale = 'interstellar';
                }

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

pinButton.addEventListener('click', (event) => {
    event.stopPropagation(); // Prevent the main click handler from firing
    if (!focusedObject || !focusedObject.name) return;

    if (pinnedObjects.has(focusedObject.name)) {
        pinnedObjects.delete(focusedObject.name);
        pinButton.textContent = 'Pin';
        updatePinnedItemsList();
    } else {
        pinnedObjects.add(focusedObject.name);
        pinButton.textContent = 'Unpin';
        updatePinnedItemsList();
    }
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

let desiredCameraDistance = 0;
// Cancel auto-zoom if user interacts with controls
controls.addEventListener('start', () => {
    if (autoZoom.active) {
        autoZoom.active = false;
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
    SYSTEM_TO_INTERSTELLAR: 63241,     // ~1 ly in AU
    INTERSTELLAR_TO_GALACTIC: 18972300, // ~300 ly in AU
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
}

/**
 * Applies a fade effect to a celestial object, its orbit, and its label.
 * @param {object} celestial - The celestial object from the planets or moons array.
 * @param {number} opacity - The target opacity (0.0 to 1.0).
 * @param {boolean} isPlanet - Flag to distinguish between planet and moon structure.
 * @param {boolean} fadeLabel - Flag to control if the label should be faded.
 */
function applyFade(celestial, opacity, isPlanet = false, fadeLabel = true) {
    const celestialMesh = isPlanet ? celestial.planet : (celestial.mesh || celestial);
    const orbit = isPlanet ? orbitRings.find(o => o.uuid === celestial.orbitRingUUID) : celestial.orbit;
    const label = celestial.label;

    // Fade the main mesh(es)
    if (celestialMesh) {
        celestialMesh.traverse(child => {
            // Don't fade Venus's permanent atmosphere
            if (child.isMesh && child.material && child.material.map !== planetTextures.venusAtmos && child.material.opacity !== undefined) {
                child.material.opacity = opacity;
                child.material.transparent = opacity < 1.0;
            }
        });
    }

    // Fade the orbit line
    if (isPlanet) {
        if (orbit && orbit.ring && orbit.ring.material) {
            orbit.ring.material.opacity = opacity * 0.6; // Increased brightness
        }
    } else if (orbit && orbit.material) { // This handles moon orbits.
        // Ensure the orbit is not shown if the global checkbox is off.
        if (!showOrbitsCheckbox.checked) opacity = 0;
        orbit.material.opacity = opacity * 1.0; // Increased brightness
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
    starMeshes.forEach(sm => {
        if (sm.material.opacity > 0.1) intersectableObjects.push(sm);
    });
    planets.forEach(p => {
        // Check the opacity of the actual surface mesh inside the planet's group
        if (p.planet.children[0] && p.planet.children[0].material.opacity > 0.1) {
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

            // For exoplanets, offset the position by their parent star's position.
            const parentStar = stellarObjects.find(s => s.mesh.name === p.parentStar);
            if (parentStar) {
                p.planet.position.add(parentStar.mesh.position);
                // Also move the orbit ring to the star's position
                const orbitData = orbitRings.find(o => o.ring.uuid === p.planet.orbitRingUUID);
                if (orbitData) {
                    orbitData.ring.position.copy(parentStar.mesh.position);
                }
            }

            // Planet's own rotation (around its Y-axis)
            // We rotate the first child (the surface mesh) instead of the whole group.
            if (p.planet.children[0]) p.planet.children[0].rotation.y += p.rotationSpeed * animationSpeed;
        });
    }

    // Animate the asteroid belt
    if (asteroidBelt && !isAnimationPaused) {
        asteroidBeltUniforms.u_time.value += 0.1 * animationSpeed; // Always update time
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
        const isPlanetOrMoonFocused = focusedObject && (allPlanetData.some(p => p.name === focusedObject.name) || moons.some(m => m.mesh.name === focusedObject.name));
        
        if (currentScale === 'system' && isPlanetOrMoonFocused && distanceToTarget < SCALES.PLANET_TO_SYSTEM) {
            currentScale = 'planet';
        } else if (currentScale === 'planet' && (!isPlanetOrMoonFocused || distanceToTarget > SCALES.PLANET_TO_SYSTEM * 1.2)) {
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
            startAutoZoom(galacticViewDistScene, new THREE.Vector3(0,0,0)); // Zoom out towards galactic center
        } else if (currentScale === 'galactic' && distanceInAU < SCALES.INTERSTELLAR_TO_GALACTIC) {
            currentScale = 'interstellar';
            startAutoZoom(SCALES.INTERSTELLAR_TO_GALACTIC * 0.8 * sceneUnitsPerAU);
        } else if (currentScale === 'planet' && !isPlanetOrMoonFocused) {
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
        }
    }

    // --- Cinematic Fading Logic ---
    const planetFade = THREE.MathUtils.smoothstep(distanceToTarget, SCALES.PLANET_TO_SYSTEM * 0.8, SCALES.PLANET_TO_SYSTEM);
    const systemFade = THREE.MathUtils.smoothstep(distanceInAU, SCALES.SYSTEM_TO_INTERSTELLAR * 0.8, SCALES.SYSTEM_TO_INTERSTELLAR);
    const interstellarFade = THREE.MathUtils.smoothstep(distanceInAU, SCALES.SYSTEM_TO_INTERSTELLAR, SCALES.INTERSTELLAR_TO_GALACTIC);

    // New fade logic specifically for planet labels based on a fixed AU distance.
    const planetLabelFade = THREE.MathUtils.smoothstep(distanceInAU, 450, 500);

    const isInterstellarView = currentScale === 'interstellar' || currentScale === 'galactic';
    const interstellarOpacity = systemFade * (1.0 - interstellarFade); // Fade in, then out

    // --- Fading for Sol System vs Sol Sprite ---
    const solarSystemOpacity = 1.0 - systemFade;

    planets.forEach(p => {
        // Determine the planet's system. For Sol system planets, p.starName is 'Sol'.
        // For exoplanets, we look up the system from the star database. This was the source of the bug.
        const parentSystem = p.starName === 'Sol' 
            ? 'Sol' 
            : starDatabase.find(s => s.name === p.parentStar)?.system;
            
        const isLocalPlanet = parentSystem === lastFocusedSystem;
        const planetOpacity = isLocalPlanet ? solarSystemOpacity : 0;

        // We need to find the corresponding label for the planet
        p.label = labels.find(l => l.object === p.planet);

        // Fade the orbit ring
        const orbitData = orbitRings.find(o => o.ring.uuid === p.planet.orbitRingUUID);
        if (orbitData) orbitData.ring.material.opacity = isLocalPlanet ? (solarSystemOpacity * 0.6) : 0; // Original fading logic
        // The planet mesh fades at the system scale. We pass 'false' to prevent applyFade from touching the label.
        applyFade(p, planetOpacity, true, false);
        // The planet label fades out much sooner, at 250 AU.
        const labelOpacity = 1.0 - planetLabelFade;
        if (p.label) {
            // A pinned label should always be visible, otherwise use the calculated opacity.
            const finalOpacity = pinnedObjects.has(p.planet.name) ? 1.0 : (isLocalPlanet ? labelOpacity : 0);
            p.label.element.style.opacity = finalOpacity;
        }
        if (p.label) p.label.element.style.pointerEvents = (isLocalPlanet && labelOpacity > 0.5) ? 'auto' : 'none';
    });

    // Fade in moon objects
    moons.forEach(m => {
        let moonOpacity = 0;
        const isThisMoonFocused = focusedObject && focusedObject.name === m.mesh.name;
        let shouldFadeLabel = true;

        if (isThisMoonFocused) {
            // If this specific moon is focused, force it to be fully visible, overriding other logic.
            moonOpacity = 1.0;
            shouldFadeLabel = false; // We will handle the label opacity manually.
            if (m.label) m.label.element.style.opacity = 1.0;
        } else {
            // Standard visibility logic for unfocused moons.
            const isFocusedOnParent = focusedObject && m.mesh.parent && focusedObject.name === m.mesh.parent.name;
            if (currentScale === 'planet' && isFocusedOnParent) {
                moonOpacity = 1.0 - planetFade;
            }
        }

        // Pinned moon labels should always be visible.
        const isPinned = pinnedObjects.has(m.mesh.name);
        if (isPinned) shouldFadeLabel = false; // Prevent applyFade from touching a pinned label

        applyFade(m, moonOpacity, false, shouldFadeLabel);
    });

    // Fade the asteroid belt along with the Sol system
    if (asteroidBelt) {
        const isVisible = lastFocusedSystem === 'Sol' && solarSystemOpacity > 0.01 && showAsteroidsCheckbox.checked;
        // Instead of toggling visibility, we update a uniform. This ensures the shader
        // continues to run and update time, preventing lighting from breaking.
        asteroidBeltUniforms.u_visibility.value = isVisible ? 1.0 : 0.0;
    }

    // Fade in/out the system-scale star meshes and their lights
    starMeshes.forEach(mesh => {
        const isLocalStar = starSystems[lastFocusedSystem]?.stars.some(s => s.name === mesh.name);
        const opacity = isLocalStar ? solarSystemOpacity : 0;
        mesh.material.opacity = opacity;
        // Explicitly set the opacity for the system-scale star's label.
        if (mesh.label && mesh.label.element && !pinnedObjects.has(mesh.name)) {
            mesh.label.element.style.opacity = opacity;
        }
    });
    starLights.forEach(light => {
        const isLocalStar = starSystems[lastFocusedSystem]?.stars.some(s => light.position.equals(s.position));
        light.visible = isLocalStar && solarSystemOpacity > 0.1;
    });


    // Fade in stellar objects
    stellarObjects.forEach(s => {

        // --- Handle Label Visibility for Interstellar Objects ---
        if (s.label && s.label.element) {
            const isMultiStarSystem = starSystems[s.system] && starSystems[s.system].stars.length > 1;
            const isPinned = pinnedObjects.has(s.mesh.name);
            let finalOpacity = 0; // Default to hidden

            if (isInterstellarView) {
                if (isMultiStarSystem) {
                    // In interstellar view, multi-star systems use a system label, so hide individual ones.
                    finalOpacity = 0;
                } else {
                    // For single-star systems, show the label.
                    finalOpacity = interstellarOpacity;
                }
            }

            // A pinned label should always be visible, overriding other logic.
            if (isPinned) finalOpacity = 1.0;

            s.label.element.style.opacity = finalOpacity;
            s.label.element.style.pointerEvents = finalOpacity > 0.5 ? 'auto' : 'none';
        }

        const isLocalStarSprite = s.system === lastFocusedSystem;

        if (isLocalStarSprite) {
            // If this sprite belongs to the currently focused system, its visibility should be
            // the inverse of the system-scale objects (fading out as system fades in),
            // but it should ALSO fade out at the galactic scale.
            s.mesh.material.opacity = (1.0 - solarSystemOpacity) * (1.0 - interstellarFade);
        } else {
            // For all other distant stars, fade them based on the interstellar scale.
            s.mesh.material.opacity = systemFade * (1.0 - interstellarFade);
        }
    });

    // --- Handle System Label Visibility ---
    Object.values(systemLabels).forEach(label => {
        const opacity = pinnedObjects.has(label.element.textContent) ? 1.0 : (isInterstellarView ? interstellarOpacity : 0);
        label.element.style.opacity = opacity;
        label.element.style.pointerEvents = (opacity > 0.5) ? 'auto' : 'none';
        // The position and z-index are handled in the sorting logic below.
    });

    // --- Z-Index Sorting for All Visible Labels ---
    const visibleLabels = [];

    // Collect all labels that should be visible and sortable
    labels.forEach(label => {
        // Only consider labels whose HTML element is currently visible (opacity > 0)
        if (parseFloat(label.element.style.opacity) > 0.01) {
            const worldPosition = new THREE.Vector3();
            label.object.getWorldPosition(worldPosition);
            visibleLabels.push({
                element: label.element,
                position: worldPosition,
                distance: camera.position.distanceTo(worldPosition)
            });
        }
    });
    // Also collect system labels if they are visible
    Object.values(systemLabels).forEach(label => {
        if (parseFloat(label.element.style.opacity) > 0.01) {
            visibleLabels.push({
                element: label.element,
                position: label.position, // System labels have a static world position
                distance: camera.position.distanceTo(label.position)
            });
        }
    });

    // Sort all labels by distance to camera for correct z-index stacking
    const sortedLabels = visibleLabels.sort((a, b) => b.distance - a.distance); // Farthest to closest

    sortedLabels.forEach((label, index) => {
        label.element.style.zIndex = index; // Closer labels get a higher z-index
        updateLabelPosition(label.element, label.position);
    });

    // Camera focusing logic
    if (focusedObject && !cameraTransition.active) { // Don't run manual follow logic during a transition
        const targetPosition = new THREE.Vector3();
        focusedObject.getWorldPosition(targetPosition);

        if (focusedObject !== previousFocusedObject) {
            console.log(`Focus changed. Current system is now: ${lastFocusedSystem}`);
            previousFocusedObject = focusedObject;
        }

        // The desired distance is the current distance from the camera to the controls' target.
        // This allows the user to zoom freely, and we just maintain that new distance as the object moves.
        const currentDistance = camera.position.distanceTo(controls.target);
        maintainCameraDistance(targetPosition, currentDistance);

        // Update the last focused system
        const objectData = allPlanetData.find(p => p.name === focusedObject.name) || starDatabase.find(s => s.name === focusedObject.name);
        if (objectData) {
            lastFocusedSystem = objectData.system || objectData.star || 'Sol';
        } else if (focusedObject.name === 'Sol') {
            lastFocusedSystem = 'Sol';
        }
    }

    // --- Final Opacity Updates for Large-Scale Objects ---
    // The starfield should fade in at interstellar scale, but fade out completely

    // Make the galaxy spin slowly
    if (!isAnimationPaused) {
        const galaxyRotationSpeed = 0.00005 * animationSpeed; // A very slow, majestic rotation
        galaxy.rotation.y += galaxyRotationSpeed;
        galaxyLabeled.rotation.y += galaxyRotationSpeed;
        galaxyPointClouds.thinDisk.rotation.y += galaxyRotationSpeed;
        galaxyPointClouds.thickDisk.rotation.y += galaxyRotationSpeed;
        galaxyPointClouds.bulge.rotation.y += galaxyRotationSpeed;
        // The halo is large and spherical, so rotation isn't as noticeable/necessary.
    }

    // Smoothly transition between labeled and unlabeled galaxy maps
    const galaxyLabelOpacity = THREE.MathUtils.lerp(galaxyLabeled.material.opacity, showGalaxyDiagramCheckbox.checked ? 1.0 : 0.0, 0.05);
    galaxy.material.opacity = interstellarFade * (1.0 - galaxyLabelOpacity);
    galaxyLabeled.material.opacity = interstellarFade * galaxyLabelOpacity;

    // Fade in the volumetric galaxy point clouds at the galactic scale
    const galacticOpacity = THREE.MathUtils.smoothstep(distanceInAU, SCALES.INTERSTELLAR_TO_GALACTIC * 0.5, SCALES.INTERSTELLAR_TO_GALACTIC * 2.0);
    galaxyPointClouds.thinDisk.material.opacity = galacticOpacity;
    galaxyPointClouds.thickDisk.material.opacity = galacticOpacity * 0.7;
    galaxyPointClouds.bulge.material.opacity = galacticOpacity;
    galaxyPointClouds.halo.material.opacity = galacticOpacity * 0.3; // Halo is even fainter



    // Required if controls.enableDamping is true
    controls.update();

    // Render the scene from the perspective of the camera
    renderer.render(scene, camera);
}

/**
 * Smoothly follows a target object while maintaining a fixed distance.
 * @param {THREE.Vector3} targetPosition - The world position of the object to follow.
 * @param {number} distance - The distance to maintain from the object.
 */
function maintainCameraDistance(targetPosition, distance) {
    // If the "Lock Camera" checkbox is checked, also lock the camera's position
    // relative to the target, making the object appear stationary on screen.
    if (lockCameraCheckbox.checked) {
        // For a rigid lock, instantly snap both the target and the camera position.
        controls.target.copy(targetPosition);

        // Calculate the ideal camera position based on the locked target
        const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
        offset.setLength(distance); // Use the provided stable distance
        const newCameraPosition = new THREE.Vector3().addVectors(controls.target, offset);

        camera.position.copy(newCameraPosition);
    } else {
        // If not locked, the target should follow the object.
        // A lerp is used here to smooth out any jitter from the object's own movement,
        // but the main focus transition is handled by the cameraTransition logic.
        const followLerpFactor = cameraTransition.active ? 1.0 : 0.1;
        controls.target.lerp(targetPosition, followLerpFactor);
    }
}

// 7. Resize Handler
// Ensures the scene resizes correctly when the browser window changes size.
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start the animation loop
async function main() {
    const loadingManager = new THREE.LoadingManager();
    const loader = new THREE.TextureLoader(loadingManager);

    const texturePaths = {
        sun: 'textures/stars/2k_sun.png',
        sun_blue: 'textures/stars/2k_sun_blue.png',
        sun_orange: 'textures/stars/2k_sun_orange.png',
        sun_red: 'textures/stars/2k_sun_red.png',
        sun_white: 'textures/stars/2k_sun_white.png',
        mercury: 'textures/planets/2k_mercury.jpg',
        venusSurface: 'textures/planets/2k_venus_surface.jpg',
        venusAtmos: 'textures/planets/2k_venus_atmosphere.jpg',
        earth: 'textures/planets/2k_earth.jpg',
        mars: 'textures/planets/2k_mars.jpg',
        jupiter: 'textures/planets/2k_jupiter.jpg',
        saturn: 'textures/planets/2k_saturn.jpg',
        uranus: 'textures/planets/2k_uranus.jpg',
        moon: 'textures/moons/2k_moon.jpg',
        neptune: 'textures/planets/2k_neptune.jpg',
        saturnRing: 'textures/planets/2k_saturn_ring_alpha.png',
        flare0: "textures/lensflare/stellar_starview.png",
        flare3: "textures/lensflare/stellar_starview.png",
        star: 'textures/lensflare/stellar_starview.png',
        star_blue: 'textures/lensflare/stellar_starview_blue.png',
        galaxy: 'textures/galaxies/milkyway.png',
        galaxy_labeled: 'textures/galaxies/milkyway_labeled.png',
    };

    const miscTexturePaths = {
        asteroid: 'textures/misc/asteroid.jpg'
    };

    // Load all textures asynchronously
    const texturePromises = Object.entries(texturePaths).map(([key, path]) => loader.loadAsync(path).then(texture => [key, texture]));
    const miscTexturePromises = Object.entries(miscTexturePaths).map(([key, path]) => loader.loadAsync(path).then(texture => [key, texture]));

    planetTextures = Object.fromEntries(await Promise.all(texturePromises));
    miscTextures = Object.fromEntries(await Promise.all(miscTexturePromises));

    // --- Scene Initialization (now that textures are loaded) ---
    createStarSystem(solSystemData);
    Object.values(allSystems).forEach(createStarSystem);
    asteroidBelt = createAsteroidBelt();
    galaxyPointClouds = createVolumetricGalaxy();
    ({ galaxy, galaxyLabeled } = createGalaxyMeshes());

    // Start the animation loop
    animate();
}

main();