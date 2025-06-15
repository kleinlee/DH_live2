// 全局变量
let video_asset_url = "assets/8559d3f9-badf-4120-bb76-736152af3382/combined_data.json.gz";
let video_url = "assets/8559d3f9-badf-4120-bb76-736152af3382/01.webm";
let characterVideo = null;
let isPlaying = true;
let isMuted = true;
let animationFrameId = null;

// 初始化视频播放器
characterVideo = document.createElement('video');
characterVideo.setAttribute('playsinline', '');
characterVideo.crossOrigin = "";
characterVideo.style.display = 'none';
document.body.appendChild(characterVideo);

const canvas_video = document.getElementById('canvas_video');
const ctx_video = canvas_video.getContext('2d', { willReadFrequently: true });
// 初始化页面
document.addEventListener('DOMContentLoaded', function() {
    // 添加开始按钮事件
    document.getElementById('startMessage').addEventListener('click', function() {
        this.style.display = 'none';
        document.getElementById('screen2').style.display = 'block';
        playCharacterVideo(video_url, video_asset_url);
    });
});

// 缓存已处理的视频URL
const videoURLCache = new Map();

// 播放角色视频
async function playCharacterVideo() {

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    await newVideoTask(video_asset_url);

    // 获取原始视频URL
    const originalVideoURL = video_url;
    let finalVideoURL = originalVideoURL;

    try {
        // 检查缓存中是否有处理过的URL
        if (!videoURLCache.has(originalVideoURL)) {
            // 获取视频数据并创建同源URL
            const response = await fetch(originalVideoURL, {
                mode: 'cors',
                credentials: 'omit'
            });

            if (!response.ok) throw new Error('视频获取失败');

            // 将响应转为Blob
            const blob = await response.blob();
            // 创建同源对象URL
            const blobURL = URL.createObjectURL(blob);

            // 缓存结果
            videoURLCache.set(originalVideoURL, blobURL);
        }

        // 使用缓存的同源URL
        finalVideoURL = videoURLCache.get(originalVideoURL);
    } catch (error) {
        console.warn('视频中转失败，使用原始URL:', error);
        // 失败时添加时间戳绕过缓存
        finalVideoURL = originalVideoURL + '?ts=' + Date.now();
    }

    // 设置视频源（使用同源URL或带时间戳的原始URL）
    characterVideo.src = finalVideoURL;
    characterVideo.loop = true;
    characterVideo.muted = true;
    characterVideo.playsInline = true;

    characterVideo.load();
    try {
        await characterVideo.play();
        isPlaying = true;
        if (characterVideo.readyState >= 2) {
            await processVideoFrames();
        }

    } catch (e) {
        console.error('视频播放失败:', e);
    }
}

// 在Canvas上绘制视频
function drawVideoToCanvas() {
    if (characterVideo.readyState >= 2) {
        // 设置Canvas尺寸为视频尺寸
        canvas_video.width = characterVideo.videoWidth;
        canvas_video.height = characterVideo.videoHeight;

        // 绘制视频帧
        ctx_video.drawImage(characterVideo, 0, 0, canvas_video.width, canvas_video.height);
    }

    // 继续下一帧
    animationFrameId = requestAnimationFrame(drawVideoToCanvas);
}

let fps_enabled = false; // 全局参数，控制是否显示FPS
let frameTimes = []; // 用于存储最近几帧的时间戳

async function fetchVideoUtilData(gzipUrl) {
        // 从服务器加载 Gzip 压缩的 JSON 文件
        const response = await fetch(gzipUrl);
        const compressedData = await response.arrayBuffer();
        const decompressedData = pako.inflate(new Uint8Array(compressedData), { to: 'string' });
        const combinedData = JSON.parse(decompressedData);
        return combinedData;
}
let asset_dir = "assets";
let isPaused = false; // 标志位，控制是否暂停处理
// 获取 characterDropdown 元素
const characterDropdown = document.getElementById('characterDropdown');


let combinedData;

let frameIndex = 0;
const frameInterval = 40;
let lastFrameTime = performance.now();

// 原始webgl渲染
const canvas_gl = document.getElementById('canvas_gl');
const gl = canvas_gl.getContext('webgl2', { antialias: false });

// 缩放到128x128
const resizedCanvas = document.createElement('canvas');
const resizedCtx = resizedCanvas.getContext('2d', { willReadFrequently: true });
resizedCanvas.width = 128;
resizedCanvas.height = 128;

// 创建一个像素缓冲区来存储读取的像素数据
const pixels_fbo = new Uint8Array(128 * 128 * 4);

let objData;
let dataSets = [];

let program;
let indexBuffer;
let positionBuffer;
const texture_bs = gl.createTexture();
var bs_array = new Float32Array(12);

let currentDataSetIndex;
let lastDataSetIndex = -1;

let imageDataPtr = null;
let imageDataGlPtr = null;
let bsPtr = null;

// 解析OBJ文件
function parseObjFile(text) {
    const vertices = [];
    const vt = [];
    const faces = [];
    const lines = text.split('\n');

    lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'v') {
            vertices.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]),
                parseFloat(parts[4]), parseFloat(parts[5]));
        } else if (parts[0] === 'f') {
            const face = parts.slice(1).map(part => {
                const indices = part.split('/').map(index => parseInt(index, 10) - 1);
                return indices[0];
            });
            faces.push(...face);
        }
    });

    return { vertices, faces };
}

async function loadSecret(secret) {
    try {
        let jsonString = secret;
        // 分配内存
        // 使用 TextEncoder 计算 UTF-8 字节长度
        function getUTF8Length(str) {
            const encoder = new TextEncoder();
            const encoded = encoder.encode(str);
            return encoded.length + 1; // +1 是为了包含 null 终止符
        }
        let lengthBytes = getUTF8Length(jsonString);
        console.log("GG", lengthBytes)
        let stringPointer = Module._malloc(lengthBytes);
        Module.stringToUTF8(jsonString, stringPointer, lengthBytes);
        Module._processSecret(stringPointer);
        Module._free(stringPointer);
    } catch (error) {
        console.error('Error loadSecret:', error);
        throw error;
    }
}

async function loadCombinedData() {
    try {
        let { json_data, ...WasmInputJson } = combinedData;

        // 提取 jsonData
        dataSets = combinedData.json_data;
        console.log('JSON data loaded successfully:', dataSets.length, 'sets.');

        // 将 dataSets 的内容逆序并加到原列表后面
        dataSets = dataSets.concat(dataSets.slice().reverse());
        console.log('DataSets after adding reversed content:', dataSets.length, 'sets.');

        // 提取 objData
        objData = parseObjFile(combinedData.face3D_obj.join('\n'));
        console.log('OBJ data loaded successfully:', objData.vertices.length, 'vertices,', objData.faces.length, 'faces.');
    } catch (error) {
        console.error('Error loading the combined data:', error);
        throw error;
    }
}

async function init_gl() {
    // WebGL Shaders
    const vertexShaderSource = `#version 300 es
        layout(location = 0) in vec3 a_position;
        layout(location = 1) in vec2 a_texture;
        uniform float bsVec[12];
        uniform mat4 gProjection;
        uniform mat4 gWorld0;
        uniform sampler2D texture_bs;
        uniform vec2 vertBuffer[209];
        out vec2 v_texture;
        out vec2 v_bias;

        vec4 calculateMorphPosition(vec3 position, vec2 textureCoord) {
            vec4 tmp_Position2 = vec4(position, 1.0);
            if (textureCoord.x < 3.0 && textureCoord.x >= 0.0) {
                vec3 morphSum = vec3(0.0);
                for (int i = 0; i < 6; i++) {
                    ivec2 coord = ivec2(int(textureCoord.y), i);
                    vec3 morph = texelFetch(texture_bs, coord, 0).xyz * 2.0 - 1.0;
                    morphSum += bsVec[i] * morph;
                }
                tmp_Position2.xyz += morphSum;
            }
            else if (textureCoord.x == 4.0) {
                // lower teeth
                vec3 morphSum = vec3(0.0, (bsVec[0] + bsVec[1]) / 2.7 + 6.0, 0.0);
                tmp_Position2.xyz += morphSum;
            }
            return tmp_Position2;
        }

        void main() {
            mat4 gWorld = gWorld0;

            vec4 tmp_Position2 = calculateMorphPosition(a_position, a_texture);
            vec4 tmp_Position = gWorld * tmp_Position2;

            v_bias = vec2(0.0, 0.0);
            if (a_texture.x == -1.0f) {
                v_bias = vec2(0.0, 0.0);
            }
            else if (a_texture.y < 209.0f) {
                vec4 vert_new = gProjection * vec4(tmp_Position.x, tmp_Position.y, tmp_Position.z, 1.0);
                v_bias = vert_new.xy - (vertBuffer[int(a_texture.y)].xy / 128.0 * 2.0 - 1.0);
            }

            if (a_texture.x >= 3.0f) {
                gl_Position = gProjection * vec4(tmp_Position.x, tmp_Position.y, 500.0, 1.0);
            }
            else {
                gl_Position = gProjection * vec4(tmp_Position.x, tmp_Position.y, tmp_Position.z, 1.0);
            }

            v_texture = a_texture;
        }
    `;

    const fragmentShaderSource = `#version 300 es
        precision mediump float;
        in mediump vec2 v_texture;
        in mediump vec2 v_bias;
        out vec4 out_color;

        void main() {
            if (v_texture.x == 3.0f) {
                out_color = vec4(0.0, 1.0, 0.0, 1.0);
            }
            else if (v_texture.x == 4.0f) {
                out_color = vec4(0.0, 0.0, 1.0, 1.0);
            }
            else if (v_texture.x > 3.0f && v_texture.x < 4.0f) {
                out_color = vec4(0.0, 0.0, 0.0, 1.0);
            }
            else {
                vec2 wrap = (v_bias.xy + 1.0) / 2.0;
                out_color = vec4(wrap.xy, 0.5, 1.0);
            }
        }
    `;

    // Compile shaders and link program
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);

    program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    // Set up vertex data
    positionBuffer = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(objData.vertices), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);

    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);

    indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(objData.faces), gl.STATIC_DRAW);

    var image = new Image();
    image.onload = function () {
        gl.bindTexture(gl.TEXTURE_2D, texture_bs);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(gl.getUniformLocation(program, 'texture_bs'), 0);
    };
    image.src = 'common/bs_texture_halfFace.png';
}

async function setupVertsBuffers() {
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(objData.vertices), gl.STATIC_DRAW);
}

async function newVideoTask(data_url) {
    try {
        combinedData = await fetchVideoUtilData(data_url);

        await loadSecret(combinedData.encrypted_data);
        await loadCombinedData();
        await init_gl();
        await setupVertsBuffers();
        initMemory();
    } catch (error) {
        console.error('视频任务初始化失败:', error);
        alert(`操作失败: ${error.message}`);
    }
}

characterVideo.addEventListener('loadedmetadata', () => {
    console.log("loadedmetadata", characterVideo.videoWidth, characterVideo.videoHeight)
    canvas_video.width = characterVideo.videoWidth;
    canvas_video.height = characterVideo.videoHeight;
});

function cerateOrthoMatrix() {
    const orthoMatrix = new Float32Array(16);

    // 定义正交投影参数
    const left = 0;
    const right = 128;
    const bottom = 0;
    const top = 128;
    const near = 1000;
    const far = -1000;

    // 计算各轴跨度
    const rl = right - left;    // 128
    const tb = top - bottom;    // 128
    const fn = far - near;      // -2000

    // 列主序填充正交投影矩阵
    // 第一列 (x)
    orthoMatrix[0] = 2 / rl;    // 2/128 = 0.015625
    orthoMatrix[1] = 0;
    orthoMatrix[2] = 0;
    orthoMatrix[3] = 0;

    // 第二列 (y)
    orthoMatrix[4] = 0;
    orthoMatrix[5] = 2 / tb;    // 2/128 = 0.015625
    orthoMatrix[6] = 0;
    orthoMatrix[7] = 0;

    // 第三列 (z)
    orthoMatrix[8] = 0;
    orthoMatrix[9] = 0;
    orthoMatrix[10] = -2 / fn;  // -2/-2000 = 0.001
    orthoMatrix[11] = 0;

    // 第四列 (平移)
    orthoMatrix[12] = -(right + left) / rl;  // -128/128 = -1
    orthoMatrix[13] = -(top + bottom) / tb;  // -128/128 = -1
    orthoMatrix[14] = -(far + near) / fn;    // -(-1000+1000)/-2000 = 0
    orthoMatrix[15] = 1;
    return orthoMatrix;
}

function render(mat_world, subPoints, bsArray) {
    if (isPaused) {
        // 如果暂停，直接返回，不处理帧
        return;
    }
    gl.useProgram(program);
    const worldMatUniformLocation = gl.getUniformLocation(program, "gWorld0");
    gl.uniformMatrix4fv(worldMatUniformLocation, false, mat_world);

    gl.uniform2fv(gl.getUniformLocation(program, "vertBuffer"), subPoints);
    gl.uniform1fv(gl.getUniformLocation(program, "bsVec"), bsArray);

    const projectionUniformLocation = gl.getUniformLocation(program, "gProjection");
    const orthoMatrix = cerateOrthoMatrix();
    gl.uniformMatrix4fv(projectionUniformLocation, false, orthoMatrix);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CW);
    gl.clearColor(0.5, 0.5, 0.5, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    gl.drawElements(gl.TRIANGLES, objData.faces.length, gl.UNSIGNED_SHORT, 0);

    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels_fbo);
}

function getAccurateFrameIndex(tempCtx, canvasWidth) {
    const x = canvasWidth - 2;
    const y = 0;
    const width = 2;
    const height = 2;
    const imageData = tempCtx.getImageData(x, y, width, height);
    const data = imageData.data;

    // 计算Alpha平均值
    let alphaSum = 0;
    const alphaValues = [];
    for (let i = 3; i < data.length; i += 4) {
        alphaSum += data[i];
        alphaValues.push(data[i])
    }
    return Math.round(alphaSum / 4 / 40);
}

function findRealFrame(currentFrame, currentFrame0) {
    for (let offset = -3; offset <= 3; offset++) {
        const candidate = currentFrame + offset;
        if (candidate >= 0 && candidate % 7 === currentFrame0) {
            return candidate;
        }
    }
    console.warn("No exact match found, returning approximate frame");
    return currentFrame;
}

async function processVideoFrames() {
    if (isPaused) {
        // 如果暂停，直接返回，不处理帧
        return;
    }

    const targetFps = 25;
    let lastFrameTime = 0;
    let lastProcessedFrame = -1;

    async function processFrame(currentTime) {
        const now = performance.now();
        const currentFrame = Math.floor(characterVideo.currentTime * targetFps);

        // Only process if this is a new frame (avoid duplicate processing)
        if (currentFrame !== lastProcessedFrame) {
            ctx_video.globalCompositeOperation = 'copy';  // 完全替换目标区域
            ctx_video.clearRect(0, 0, canvas_video.width, canvas_video.height);
            ctx_video.drawImage(characterVideo, 0, 0, canvas_video.width, canvas_video.height);
            const currentFrame0 = getAccurateFrameIndex(ctx_video, canvas_video.width);
            const realFrame = findRealFrame(currentFrame, currentFrame0);
        //    console.log(realFrame, characterVideo.currentTime)
            fps_enabled = true;
            if (fps_enabled) {
                frameTimes.push(currentTime);
                // 只保留最近1秒的帧时间
                while (frameTimes.length > 0 && performance.now() - frameTimes[0] > 1000) {
                    frameTimes.shift();
                }
                const fps = frameTimes.length;
                ctx_video.fillStyle = 'black';
                ctx_video.font = '16px Arial';
                ctx_video.textAlign = 'right';
                ctx_video.globalCompositeOperation = 'source-over';
                ctx_video.fillText(`FPS: ${fps}`, canvas_video.width - 10, 20);
            }
            processDataSet(realFrame);
            lastProcessedFrame = currentFrame;
            lastFrameTime = now;
        }

        animationFrameId = requestAnimationFrame(processFrame);
    }
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    animationFrameId = requestAnimationFrame(processFrame);
}

async function initMemory() {
    const imageDataSize = 128 * 128 * 4; // RGBA
    imageDataPtr = Module._malloc(imageDataSize);
    imageDataGlPtr = Module._malloc(imageDataSize);
    bsPtr = Module._malloc(12 * 4); // 12 floats for blend shape
}

async function processDataSet(currentDataSetIndex) {
    if (isPaused) {
        // 如果暂停，直接返回，不处理帧
        return;
    }
    const dataSet = dataSets[currentDataSetIndex];
    const rect = dataSet.rect;

    const currentpoints = dataSets[currentDataSetIndex].points;

    const matrix = new Float32Array(16);
    matrix.set(currentpoints.slice(0, 16));

    const subPoints = currentpoints.slice(16);
    Module._updateBlendShape(bsPtr, 12 * 4);
    const bsArray = new Float32Array(Module.HEAPU8.buffer, bsPtr, 12);

    render(matrix, subPoints, bsArray);
    resizedCtx.clearRect(0, 0, 128, 128);
    resizedCtx.drawImage(canvas_video, rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1], 0, 0, 128, 128);

    const imageData = resizedCtx.getImageData(0, 0, 128, 128);
    Module.HEAPU8.set(imageData.data, imageDataPtr);

    Module.HEAPU8.set(pixels_fbo, imageDataGlPtr);

    Module._processImage(imageDataPtr, 128, 128, imageDataGlPtr, 128, 128);
    const result = Module.HEAPU8.subarray(imageDataPtr, imageDataPtr + imageData.data.length);
    imageData.data.set(result);

    resizedCtx.putImageData(imageData, 0, 0);
    ctx_video.clearRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
    ctx_video.globalCompositeOperation = 'source-over';
    ctx_video.drawImage(resizedCanvas, 0, 0, 128, 128, rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
}