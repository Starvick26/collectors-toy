export const vertexSource = `#version 300 es
precision highp float;
out vec2 uv;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=vec2(p.x,1.0-p.y);gl_Position=vec4(p*2.0-1.0,0,1);}`;
export const fragmentSource = `#version 300 es
precision highp float;
in vec2 uv;out vec4 colour;
uniform sampler2D card;uniform vec2 tilt;uniform float strength;
vec3 linearise(vec3 c){return pow(c,vec3(2.2));}
void main(){
 vec4 source=texture(card,uv);vec3 base=linearise(source.rgb);
 float luminance=dot(base,vec3(.2126,.7152,.0722));
 // Printed ink attenuates reflection; this is inferred, not a material mask.
 float mask=mix(.12,.85,smoothstep(.015,.78,luminance));
 vec2 grain=vec2(sin(uv.y*1500.0+sin(uv.x*920.0)),cos(uv.x*1380.0+uv.y*43.0))*.012;
 vec3 n=normalize(vec3(tilt*.32+grain,1.0));
 vec3 view=normalize(vec3((uv-.5)*.35,1.6));
 vec3 light=normalize(vec3(-.35+tilt.x*.7,.4-tilt.y*.7,1.1));
 float cosTheta=clamp(dot(n,view),0.0,1.0);
 float fresnel=.07+.93*pow(1.0-cosTheta,5.0);
 float thickness=420.0+uv.x*85.0+uv.y*35.0+sin(uv.y*90.0)*2.0;
 // Three representative wavelengths approximate a thin-film spectrum.
 vec3 phase=6.2831853*(2.0*1.42*thickness*sqrt(1.0-(1.0-cosTheta*cosTheta)/2.0164))/vec3(650,530,460);
 vec3 interference=.5+.5*cos(phase+dot(tilt,vec2(2.5,-1.8)));
 float spec=pow(max(dot(n,normalize(light+view)),0.0),65.0);
 float beam=exp(-pow((uv.x+uv.y*.22-.55+tilt.x*.55-tilt.y*.18)*5.0,2.0));
 vec3 reflected=(interference*(.05+beam*.24+fresnel*.5)+vec3(spec*.3))*mask*strength;
 vec3 result=base+reflected;
 colour=vec4(pow(clamp(result,0.0,1.0),vec3(1.0/2.2)),source.a);
}`;

// One context for the large viewer only: never allocate one per thumbnail.
export function createTraditionalFoil(surface, image, intensity='medium') {
  const canvas=document.createElement('canvas');canvas.className='traditional-foil-canvas';canvas.setAttribute('aria-hidden','true');
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:false});
  if(!gl)return null;
  const shaders=[];let program,texture,disposed=false,ready=false,generation=0;
  let tilt=[0,0];const strength=({low:.35,medium:.65,high:1})[intensity]??.65;
  function draw(){if(disposed||!ready)return;gl.viewport(0,0,canvas.width,canvas.height);gl.uniform2f(gl.getUniformLocation(program,'tilt'),...tilt);gl.drawArrays(gl.TRIANGLES,0,3);}
  function stop(){if(disposed)return;disposed=true;generation++;surface.classList.remove('webgl-ready');canvas.remove();image.removeEventListener('load',load);gl.deleteTexture(texture);gl.deleteProgram(program);shaders.forEach(s=>gl.deleteShader(s));gl.getExtension('WEBGL_lose_context')?.loseContext();}
  function load(){
    ready=false;surface.classList.remove('webgl-ready');const version=++generation;
    const source=new Image();source.crossOrigin='anonymous';
    source.onload=()=>{if(disposed||version!==generation)return;try{
      const max=Math.min(1100,gl.getParameter(gl.MAX_TEXTURE_SIZE));const ratio=Math.min(1,max/Math.max(source.naturalWidth,source.naturalHeight));
      canvas.width=Math.max(1,Math.round(source.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(source.naturalHeight*ratio));
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
      if(gl.getError()!==gl.NO_ERROR)throw new Error('Texture upload failed');
      ready=true;draw();surface.classList.add('webgl-ready');
    }catch{stop();}};
    source.onerror=()=>{if(version===generation)stop();};source.src=image.currentSrc||image.src;
  }
  try{
    program=gl.createProgram();
    for(const [type,code] of [[gl.VERTEX_SHADER,vertexSource],[gl.FRAGMENT_SHADER,fragmentSource]]){const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));gl.attachShader(program,shader);}
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Shader link failed');gl.useProgram(program);
    texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program,'card'),0);gl.uniform1f(gl.getUniformLocation(program,'strength'),strength);
    surface.append(canvas);image.addEventListener('load',load);canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();stop();});load();
    return {update(x,y){tilt=[x,y];draw();},dispose:stop};
  }catch{stop();return null;}
}

export function attachViewerTilt(surface, update=()=>{}) {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;let pointer=null;
  function move(event){if(event.pointerType!=='mouse'&&event.pointerId!==pointer)return;const r=surface.getBoundingClientRect();
    const x=Math.max(-1,Math.min(1,(event.clientX-r.left)/r.width*2-1)),y=Math.max(-1,Math.min(1,(event.clientY-r.top)/r.height*2-1));
    surface.style.setProperty('--shine-x',`${50+x*40}%`);surface.style.setProperty('--shine-y',`${50+y*40}%`);
    if(!reduced)surface.style.transform=`perspective(1100px) rotateX(${-y*7}deg) rotateY(${x*9}deg)`;
    update(x,y);
  }
  function reset(){pointer=null;surface.style.transform='';update(0,0);}
  function down(event){if(!event.isPrimary||event.button>0)return;pointer=event.pointerId;surface.setPointerCapture(event.pointerId);move(event);}
  const leave=event=>{if(event.pointerType==='mouse')reset();};
  surface.addEventListener('pointerdown',down);surface.addEventListener('pointermove',move);surface.addEventListener('pointerup',reset);surface.addEventListener('pointercancel',reset);surface.addEventListener('lostpointercapture',reset);surface.addEventListener('pointerleave',leave);
  return ()=>{surface.removeEventListener('pointerdown',down);surface.removeEventListener('pointermove',move);surface.removeEventListener('pointerup',reset);surface.removeEventListener('pointercancel',reset);surface.removeEventListener('lostpointercapture',reset);surface.removeEventListener('pointerleave',leave);};
}