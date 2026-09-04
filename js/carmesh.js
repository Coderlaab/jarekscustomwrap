// ---------------------------------------------------------------------------
//  Vehicle mesh.
//
//  Loads the baked binary (Porsche 911 Turbo S, already rotated and scaled into
//  the shader's coordinate frame) and uploads it once. The GLB is not parsed at
//  runtime — assets/model/car.bin is position + normal + material id and
//  nothing else, which is all the shading pass needs.
// ---------------------------------------------------------------------------

export class CarMesh {
  constructor(gl){ this.gl = gl; this.ready = false; this.count = 0; }

  async load(base = 'assets/model/'){
    const gl = this.gl;
    const [meta, buf] = await Promise.all([
      fetch(base + 'car.json').then(r => r.json()),
      fetch(base + 'car.bin').then(r => r.arrayBuffer())
    ]);
    const L = meta.layout;
    this.meta = meta;

    const pos = new Float32Array(buf, L.position.offset, meta.vertices * 3);
    const nrm = new Int8Array   (buf, L.normal.offset,   meta.vertices * 4);
    const mat = new Uint8Array  (buf, L.matId.offset,    meta.vertices);
    const idx = new Uint32Array (buf, L.indices.offset,  meta.triangles * 3);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const mk = (data, target) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return b;
    };
    mk(pos, gl.ARRAY_BUFFER);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    mk(nrm, gl.ARRAY_BUFFER);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.BYTE, true, 0, 0);

    mk(mat, gl.ARRAY_BUFFER);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, false, 0, 0);

    mk(idx, gl.ELEMENT_ARRAY_BUFFER);
    gl.bindVertexArray(null);

    this.count = meta.triangles * 3;
    this.ready = true;
    return this;
  }

  draw(){
    if(!this.ready) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }
}
