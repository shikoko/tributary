// The 3D view of a model's two versions. It's loaded only when a model is shown, since it
// brings three.js with it.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { FileDiff, Media } from "../../api";
import { dataUrlBytes, missingSide } from "../../lib/media";

/** What's in a model, to compare. */
export interface ModelFacts {
  meshes: number;
  vertices: number;
  triangles: number;
  materials: number;
  /** Width, height and depth. */
  size: [number, number, number];
}

const surface = () => new THREE.MeshStandardMaterial({ color: 0xb8bfcc, roughness: 0.7, metalness: 0.05 });

/** A model's scene, from its file. */
async function load(format: string, bytes: ArrayBuffer): Promise<THREE.Object3D> {
  const text = () => new TextDecoder().decode(bytes);
  const mesh = (geometry: THREE.BufferGeometry) => {
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, surface());
  };
  switch (format) {
    case "glb":
    case "gltf":
      return new Promise((resolve, reject) => new GLTFLoader().parse(format === "glb" ? bytes : text(), "", (gltf) => resolve(gltf.scene), reject));
    case "obj": {
      const scene = new OBJLoader().parse(text());
      // OBJ files without their .mtl get plain materials.
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) child.material = surface();
      });
      return scene;
    }
    case "fbx":
      return new FBXLoader().parse(bytes, "");
    case "stl":
      return mesh(new STLLoader().parse(bytes));
    case "ply":
      return mesh(new PLYLoader().parse(bytes));
    default:
      throw new Error(`${format} models can't be shown`);
  }
}

function factsOf(object: THREE.Object3D): ModelFacts {
  let meshes = 0;
  let vertices = 0;
  let triangles = 0;
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    meshes++;
    const geometry = child.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute("position");
    vertices += positions?.count ?? 0;
    triangles += geometry.index ? geometry.index.count / 3 : (positions?.count ?? 0) / 3;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
  });
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  return { meshes, vertices, triangles: Math.round(triangles), materials: materials.size, size: [size.x, size.y, size.z] };
}

type Side = "before" | "after";
interface View {
  side: Side;
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
}
type Loaded = { object: THREE.Object3D; facts: ModelFacts } | { error: string } | null;

/** Both versions, side by side, turning together. */
export default function ModelViewer({ diff, media }: { diff: FileDiff; media: Media }) {
  const canvases = { before: useRef<HTMLCanvasElement>(null), after: useRef<HTMLCanvasElement>(null) };
  const [loaded, setLoaded] = useState<Record<Side, Loaded>>({ before: null, after: null });
  const [wireframe, setWireframe] = useState(false);
  /** This computer can't draw in 3D (no WebGL): the numbers still compare the two. */
  const [noWebGL, setNoWebGL] = useState(false);
  const scenes = useRef<{ render: () => void; setWireframe: (on: boolean) => void } | null>(null);

  // Read both models.
  useEffect(() => {
    let live = true;
    const read = async (url: string | null): Promise<Loaded> => {
      if (!url) return null;
      try {
        const object = await load(media.format, dataUrlBytes(url));
        return { object, facts: factsOf(object) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    };
    let shown: Loaded[] = [];
    Promise.all([read(media.before), read(media.after)]).then(([before, after]) => {
      shown = [before, after];
      if (live) setLoaded({ before, after });
    });
    return () => {
      live = false;
      // Give back what the models took on the graphics card.
      for (const model of shown) {
        if (!model || !("object" in model)) continue;
        model.object.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          child.geometry.dispose();
          for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
        });
      }
    };
  }, [media.before, media.after, media.format]);

  // Show them: one camera position for both, framing the bigger of the two.
  useEffect(() => {
    const sides = (["before", "after"] as const).filter((side) => {
      const model = loaded[side];
      return model && "object" in model && canvases[side].current;
    });
    if (sides.length === 0) return;
    const box = new THREE.Box3();
    for (const side of sides) box.expandByObject((loaded[side] as { object: THREE.Object3D }).object);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.001);

    let views: View[];
    try {
      views = sides.map((side) => makeView(side));
    } catch {
      setNoWebGL(true);
      return;
    }
    function makeView(side: Side) {
      const canvas = canvases[side].current!;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x30343c, 2.2));
      const light = new THREE.DirectionalLight(0xffffff, 2.5);
      light.position.set(1, 2, 3);
      scene.add(light);
      const grid = new THREE.GridHelper(radius * 4, 16, 0x353b48, 0x282d38);
      grid.position.set(center.x, box.min.y, center.z);
      scene.add(grid);
      scene.add((loaded[side] as { object: THREE.Object3D }).object);
      const camera = new THREE.PerspectiveCamera(40, 1, radius / 100, radius * 100);
      camera.position.copy(center).add(new THREE.Vector3(radius * 1.6, radius * 1.1, radius * 2.2));
      const controls = new OrbitControls(camera, canvas);
      controls.target.copy(center);
      controls.enableDamping = false;
      controls.update();
      return { side, canvas, renderer, scene, camera, controls };
    }

    const render = () => {
      for (const view of views) {
        const width = view.canvas.clientWidth;
        const height = view.canvas.clientHeight;
        if (view.canvas.width !== Math.floor(width * view.renderer.getPixelRatio())) view.renderer.setSize(width, height, false);
        view.camera.aspect = width / Math.max(1, height);
        view.camera.updateProjectionMatrix();
        view.renderer.render(view.scene, view.camera);
      }
    };
    // Turning one turns the other.
    let syncing = false;
    for (const view of views) {
      view.controls.addEventListener("change", () => {
        if (syncing) return;
        syncing = true;
        for (const other of views) {
          if (other === view) continue;
          other.camera.position.copy(view.camera.position);
          other.camera.quaternion.copy(view.camera.quaternion);
          other.controls.target.copy(view.controls.target);
          other.controls.update();
        }
        syncing = false;
        render();
      });
    }
    const observer = new ResizeObserver(render);
    for (const view of views) observer.observe(view.canvas);
    render();
    scenes.current = {
      render,
      setWireframe: (on) => {
        for (const view of views) {
          view.scene.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
              if ("wireframe" in material) (material as THREE.MeshStandardMaterial).wireframe = on;
            }
          });
        }
        render();
      },
    };
    return () => {
      observer.disconnect();
      scenes.current = null;
      for (const view of views) {
        view.controls.dispose();
        view.renderer.dispose();
      }
    };
    // Canvases are fixed refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    scenes.current?.setWireframe(wireframe);
  }, [wireframe, loaded]);

  const facts = (side: Side) => {
    const model = loaded[side];
    return model && "facts" in model ? model.facts : null;
  };
  return (
    <div className="diff-media diff-model">
      {(["before", "after"] as const).map((side) => {
        const model = loaded[side];
        return (
          <figure key={side} className="diff-media-side">
            <figcaption>{side === "before" ? "Before" : "After"}</figcaption>
            {!media[side] ? (
              <div className="diff-media-missing diff-model-frame">{missingSide(diff, side)}</div>
            ) : model && "error" in model ? (
              <div className="diff-media-missing diff-model-frame">Couldn't read this model: {model.error}</div>
            ) : (
              <div className="diff-model-frame">
                <canvas ref={canvases[side]} className="diff-model-canvas" aria-label={`${diff.path}, ${side}, in 3D`} />
                {!model && <span className="diff-model-loading">Loading…</span>}
                {model && noWebGL && <span className="diff-model-loading">This computer can't show 3D here (no WebGL). The numbers below still compare them.</span>}
              </div>
            )}
          </figure>
        );
      })}
      <ModelFacts before={facts("before")} after={facts("after")} />
      <div className="diff-media-actions">
        <span className="muted">Drag to turn, scroll to zoom, right-drag to move.</span>
        <label className="checkbox">
          <input type="checkbox" checked={wireframe} onChange={(event) => setWireframe(event.target.checked)} />
          Wireframe
        </label>
      </div>
    </div>
  );
}

/** The two versions' numbers next to each other, with what changed marked. */
function ModelFacts({ before, after }: { before: ModelFacts | null; after: ModelFacts | null }) {
  if (!before && !after) return null;
  const size = (facts: ModelFacts | null) => (facts ? facts.size.map((n) => Number(n.toPrecision(3)).toLocaleString()).join(" × ") : "—");
  const rows: [string, (facts: ModelFacts) => number | string][] = [
    ["Meshes", (facts) => facts.meshes],
    ["Vertices", (facts) => facts.vertices],
    ["Triangles", (facts) => facts.triangles],
    ["Materials", (facts) => facts.materials],
  ];
  return (
    <table className="diff-model-facts">
      <tbody>
        {rows.map(([label, read]) => {
          const [a, b] = [before ? read(before) : null, after ? read(after) : null];
          const changed = a !== null && b !== null && a !== b;
          return (
            <tr key={label} className={changed ? "changed" : undefined}>
              <th>{label}</th>
              <td>{a === null ? "—" : a.toLocaleString()}</td>
              <td>{b === null ? "—" : b.toLocaleString()}</td>
            </tr>
          );
        })}
        <tr className={before && after && size(before) !== size(after) ? "changed" : undefined}>
          <th>Size</th>
          <td>{size(before)}</td>
          <td>{size(after)}</td>
        </tr>
      </tbody>
    </table>
  );
}
