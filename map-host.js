// The dashboard can prepare map data before the WebGL map is downloaded.
export function createMapHost() {
  let real = null;
  let library = null;
  let camera = null;
  let doubleClickEnabled = true;
  const sources = new Map();
  const layers = new Map();
  const images = new Map();
  const events = [];
  const overlays = new Set();
  const canvas = document.createElement('canvas');

  class Bounds {
    constructor(a, b) { this.points = [a, b]; }
    extend(point) { this.points.push(point); return this; }
    toArray() {
      return this.points.reduce(
        (bounds, point) => [
          [Math.min(bounds[0][0], point[0]), Math.min(bounds[0][1], point[1])],
          [Math.max(bounds[1][0], point[0]), Math.max(bounds[1][1], point[1])],
        ],
        [[Infinity, Infinity], [-Infinity, -Infinity]],
      );
    }
  }

  class Overlay {
    constructor(kind, options) {
      this.kind = kind;
      this.options = options;
      this.element = options?.element || document.createElement('div');
    }
    setLngLat(position) { this.position = position; this.instance?.setLngLat(position); return this; }
    setHTML(html) { this.html = html; this.instance?.setHTML(html); return this; }
    addTo() { overlays.add(this); this.mount(); return this; }
    mount() {
      if (!real || this.instance) return;
      this.instance = new library[this.kind](this.options);
      if (this.position) this.instance.setLngLat(this.position);
      if (this.html) this.instance.setHTML(this.html);
      this.instance.addTo(real);
    }
    remove() { this.instance?.remove(); this.instance = null; overlays.delete(this); }
    getElement() { return this.instance?.getElement() || this.element; }
  }

  const map = {
    getSource: (id) => real ? real.getSource(id) : sources.get(id),
    addSource(id, options) {
      sources.set(id, {
        options,
        setData(data) {
          this.options.data = data;
          real?.getSource(id)?.setData(data);
        },
      });
      if (real && !real.getSource(id)) real.addSource(id, options);
    },
    removeSource(id) { sources.delete(id); if (real?.getSource(id)) real.removeSource(id); },
    getLayer: (id) => real ? real.getLayer(id) : layers.get(id),
    hasImage: (id) => real ? real.hasImage(id) : images.has(id),
    addImage(id, image, options) { images.set(id, { image, options }); if (real && !real.hasImage(id)) real.addImage(id, image, options); },
    addLayer(layer) { layers.set(layer.id, layer); if (real && !real.getLayer(layer.id)) real.addLayer(layer); },
    removeLayer(id) { layers.delete(id); if (real?.getLayer(id)) real.removeLayer(id); },
    moveLayer(id, beforeId) { if (real?.getLayer(id)) real.moveLayer(id, beforeId); },
    setLayoutProperty(id, key, value) {
      const layer = layers.get(id);
      if (layer) { layer.layout ||= {}; layer.layout[key] = value; }
      if (real?.getLayer(id)) real.setLayoutProperty(id, key, value);
    },
    getLayoutProperty: (id, key) => real ? real.getLayoutProperty(id, key) : layers.get(id)?.layout?.[key],
    getCanvas: () => real?.getCanvas() || canvas,
    queryTerrainElevation: (point) => real?.queryTerrainElevation(point) ?? null,
    getTerrain: () => real?.getTerrain(),
    queryRenderedFeatures: (...args) => real?.queryRenderedFeatures(...args) || [],
    getCenter: () => real?.getCenter() || { lng: 0, lat: 0 },
    on(...args) { events.push({ once: false, args }); real?.on(...args); },
    once(...args) { events.push({ once: true, args }); real?.once(...args); },
    off(...args) {
      for (let index = events.length - 1; index >= 0; index--) {
        if (events[index].args[0] === args[0] && events[index].args.at(-1) === args.at(-1)) events.splice(index, 1);
      }
      real?.off(...args);
    },
    flyTo(options) { camera = ['flyTo', options]; real?.flyTo(options); },
    easeTo(options) { camera = ['easeTo', options]; real?.easeTo(options); },
    stop() { real?.stop(); },
    resize() { real?.resize(); },
    fitBounds(bounds, options) {
      const box = bounds.toArray ? bounds.toArray() : bounds;
      camera = ['fitBounds', box, options];
      real?.fitBounds(box, options);
    },
    doubleClickZoom: {
      disable() { doubleClickEnabled = false; real?.doubleClickZoom.disable(); },
      enable() { doubleClickEnabled = true; real?.doubleClickZoom.enable(); },
    },
  };

  return {
    map,
    maplibregl: {
      Marker: class extends Overlay { constructor(options) { super('Marker', options); } },
      Popup: class extends Overlay { constructor(options) { super('Popup', options); } },
      LngLatBounds: Bounds,
    },
    attach(actual, mapLibrary) {
      real = actual;
      library = mapLibrary;
      if (!doubleClickEnabled) real.doubleClickZoom.disable();
      real.getCanvas().style.cursor = canvas.style.cursor;

      for (const [id, source] of sources) {
        try { if (!real.getSource(id)) real.addSource(id, source.options); }
        catch (error) { console.warn(`Source cartographique ignorée : ${id}`, error); }
      }
      for (const [id, image] of images) {
        try { if (!real.hasImage(id)) real.addImage(id, image.image, image.options); }
        catch (error) { console.warn(`Icône cartographique ignorée : ${id}`, error); }
      }
      for (const layer of layers.values()) {
        try { if (!real.getLayer(layer.id)) real.addLayer(layer); }
        catch (error) { console.warn(`Couche cartographique ignorée : ${layer.id}`, error); }
      }
      for (const event of events) real[event.once ? 'once' : 'on'](...event.args);
      for (const overlay of overlays) overlay.mount();
      if (camera) real[camera[0]](...camera.slice(1));
    },
  };
}
