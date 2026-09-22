// desktop/hid-worker.js
// Dedicated Worker Thread for low-level Win32 HID communication with Sony XM5
const { parentPort, workerData } = require('worker_threads');
const koffi = require('koffi');

const hid = koffi.load('hid.dll');
const setupapi = koffi.load('setupapi.dll');
const kernel32 = koffi.load('kernel32.dll');

// Win32 Structs
const GUID = koffi.struct('GUID', {
  Data1: 'uint32_t',
  Data2: 'uint16_t',
  Data3: 'uint16_t',
  Data4: koffi.array('uint8_t', 8)
});

const SP_DEVICE_INTERFACE_DATA = koffi.struct('SP_DEVICE_INTERFACE_DATA', {
  cbSize: 'uint32_t',
  InterfaceClassGuid: GUID,
  Flags: 'uint32_t',
  Reserved: 'uintptr_t'
});

const HIDD_ATTRIBUTES = koffi.struct('HIDD_ATTRIBUTES', {
  Size: 'uint32_t',
  VendorID: 'uint16_t',
  ProductID: 'uint16_t',
  VersionNumber: 'uint16_t'
});

const OVERLAPPED = koffi.struct('OVERLAPPED', {
  Internal: 'uintptr_t',
  InternalHigh: 'uintptr_t',
  Offset: 'uint32_t',
  OffsetHigh: 'uint32_t',
  hEvent: 'void*'
});

// Win32 API Functions
const HidD_GetHidGuid = hid.func('void __stdcall HidD_GetHidGuid(_Out_ GUID *Guid)');
const HidD_GetAttributes = hid.func('bool __stdcall HidD_GetAttributes(void *HidDeviceObject, _Inout_ HIDD_ATTRIBUTES *Attributes)');
const HidD_GetPreparsedData = hid.func('bool __stdcall HidD_GetPreparsedData(void *HidDeviceObject, _Out_ void **PreparsedData)');
const HidD_FreePreparsedData = hid.func('bool __stdcall HidD_FreePreparsedData(void *PreparsedData)');
const HidD_SetFeature = hid.func('bool __stdcall HidD_SetFeature(void *HidDeviceObject, const uint8_t *ReportBuffer, uint32_t ReportBufferLength)');

const HidP_GetCaps = hid.func('int32_t __stdcall HidP_GetCaps(void *PreparsedData, _Out_ uint8_t *Capabilities)');
const HidP_SetScaledUsageValue = hid.func('int32_t __stdcall HidP_SetScaledUsageValue(int32_t ReportType, uint16_t UsagePage, uint16_t LinkCollection, uint16_t Usage, int32_t ScaledValue, void *PreparsedData, _Inout_ uint8_t *Report, uint32_t ReportLength)');
const HidP_SetUsages = hid.func('int32_t __stdcall HidP_SetUsages(int32_t ReportType, uint16_t UsagePage, uint16_t LinkCollection, const uint16_t *UsageList, _Inout_ uint32_t *UsageLength, void *PreparsedData, _Inout_ uint8_t *Report, uint32_t ReportLength)');

const SetupDiGetClassDevsW = setupapi.func('void* __stdcall SetupDiGetClassDevsW(const GUID *ClassGuid, void *Enumerator, void *hwndParent, uint32_t Flags)');
const SetupDiEnumDeviceInterfaces = setupapi.func('bool __stdcall SetupDiEnumDeviceInterfaces(void *DeviceInfoSet, void *DeviceInfoData, const GUID *InterfaceClassGuid, uint32_t MemberIndex, _Inout_ SP_DEVICE_INTERFACE_DATA *DeviceInterfaceData)');
const SetupDiGetDeviceInterfaceDetailW = setupapi.func('bool __stdcall SetupDiGetDeviceInterfaceDetailW(void *DeviceInfoSet, SP_DEVICE_INTERFACE_DATA *DeviceInterfaceData, _Out_ uint8_t *DeviceInterfaceDetailData, uint32_t DeviceInterfaceDetailDataSize, _Out_ uint32_t *RequiredSize, void *DeviceInfoData)');
const SetupDiDestroyDeviceInfoList = setupapi.func('bool __stdcall SetupDiDestroyDeviceInfoList(void *DeviceInfoSet)');

const CreateFileW = kernel32.func('void* __stdcall CreateFileW(const uint16_t *lpFileName, uint32_t dwDesiredAccess, uint32_t dwShareMode, void *lpSecurityAttributes, uint32_t dwCreationDisposition, uint32_t dwFlagsAndAttributes, void *hTemplateFile)');
const ReadFile = kernel32.func('bool __stdcall ReadFile(void *hFile, _Out_ uint8_t *lpBuffer, uint32_t nNumberOfBytesToRead, _Out_ uint32_t *lpNumberOfBytesRead, _Inout_ OVERLAPPED *lpOverlapped)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *hObject)');
const CreateEventW = kernel32.func('void* __stdcall CreateEventW(void *lpEventAttributes, bool bManualReset, bool bInitialState, void *lpName)');
const ResetEvent = kernel32.func('bool __stdcall ResetEvent(void *hEvent)');
const WaitForSingleObject = kernel32.func('uint32_t __stdcall WaitForSingleObject(void *hHandle, uint32_t dwMilliseconds)');
const GetOverlappedResult = kernel32.func('bool __stdcall GetOverlappedResult(void *hFile, OVERLAPPED *lpOverlapped, _Out_ uint32_t *lpNumberOfBytesTransferred, bool bWait)');
const CancelIoEx = kernel32.func('bool __stdcall CancelIoEx(void *hFile, void *lpOverlapped)');
const GetLastError = kernel32.func('uint32_t __stdcall GetLastError()');

// Constants
const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const FILE_SHARE_READ = 0x00000001;
const FILE_SHARE_WRITE = 0x00000002;
const OPEN_EXISTING = 3;
const FILE_FLAG_OVERLAPPED = 0x40000000;
const INVALID_HANDLE_VALUE = -1;

const DIGCF_PRESENT = 0x00000002;
const DIGCF_DEVICEINTERFACE = 0x00000010;

const HIDP_STATUS_SUCCESS = 0x00110000;
const HidP_Feature = 2;

const SENSOR_PAGE = 0x0020;
const SENSOR_OTHER_CUSTOM = 0x00E1;
const USAGE_REPORT_INTERVAL = 0x030E;
const USAGE_REPORTING_ALL_EVENTS = 0x0841;
const USAGE_POWER_FULL = 0x0851;

const WAIT_OBJECT_0 = 0x00000000;
const ERROR_IO_PENDING = 997;

let isRunning = true;
let activeHandle = null;
let activeEvent = null;

// Orientation filter state
let centerQuat = null;
let filteredQuat = null;
let recenterPending = true;

parentPort.on('message', (msg) => {
  if (msg === 'stop') {
    isRunning = false;
    if (activeHandle) CancelIoEx(activeHandle, null);
  } else if (msg === 'recenter') {
    recenterPending = true;
  }
});

function stringToWide(str) {
  const buf = Buffer.alloc((str.length + 1) * 2);
  buf.write(str, 0, 'utf16le');
  return new Uint16Array(buf.buffer, buf.byteOffset, str.length + 1);
}

// Universal Android Head Tracker HID Detection
// Complies with official Android Head Tracker HID specification (UsagePage 0x0020, Usage 0x00E1)
// Works across Sony WF-1000XM5, WH-1000XM5, WH-ULT900N, XM6, LinkBuds, and any compatible headset.
const HidD_GetProductString = hid.func('bool __stdcall HidD_GetProductString(void *HidDeviceObject, _Out_ uint8_t *Buffer, uint32_t BufferLength)');

function findHeadTrackerDevice() {
  const guid = {};
  HidD_GetHidGuid(guid);

  const devInfo = SetupDiGetClassDevsW(guid, null, null, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
  if (!devInfo) return null;

  const ifaceData = {
    cbSize: 32,
    Flags: 0,
    Reserved: 0
  };

  let index = 0;
  let candidate = null;

  while (SetupDiEnumDeviceInterfaces(devInfo, null, guid, index, ifaceData)) {
    const requiredSize = [0];
    SetupDiGetDeviceInterfaceDetailW(devInfo, ifaceData, null, 0, requiredSize, null);
    const needed = requiredSize[0];
    if (needed > 0) {
      const detailBuf = Buffer.alloc(needed);
      detailBuf.writeUInt32LE(8, 0); // cbSize = 8 on x64
      if (SetupDiGetDeviceInterfaceDetailW(devInfo, ifaceData, detailBuf, needed, requiredSize, null)) {
        const pathStr = detailBuf.slice(4).toString('utf16le').replace(/\0.*$/, '');
        
        // Test open handle to query HID caps without exclusive locks
        const widePath = stringToWide(pathStr);
        const queryHandle = CreateFileW(
          widePath,
          0,
          FILE_SHARE_READ | FILE_SHARE_WRITE,
          null,
          OPEN_EXISTING,
          0,
          null
        );

        if (queryHandle && queryHandle !== INVALID_HANDLE_VALUE) {
          const ppdPtr = [null];
          if (HidD_GetPreparsedData(queryHandle, ppdPtr)) {
            const ppd = ppdPtr[0];
            const capsBuf = Buffer.alloc(64);
            if (HidP_GetCaps(ppd, capsBuf) === HIDP_STATUS_SUCCESS) {
              const usage = capsBuf.readUInt16LE(0);
              const usagePage = capsBuf.readUInt16LE(2);

              // Standard Android Head Tracker specification: UsagePage 0x0020, Usage 0x00E1
              if (usagePage === SENSOR_PAGE && usage === SENSOR_OTHER_CUSTOM) {
                // Query real device model name via USB/BT HID product string
                const prodBuf = Buffer.alloc(256);
                let productName = 'Sony Head-Tracking Headset';
                if (HidD_GetProductString(queryHandle, prodBuf, prodBuf.length)) {
                  const parsedName = prodBuf.toString('utf16le').replace(/\0.*$/, '').trim();
                  if (parsedName) productName = parsedName;
                }

                candidate = {
                  path: pathStr,
                  productName: productName,
                  inputReportByteLength: capsBuf.readUInt16LE(4),
                  featureReportByteLength: capsBuf.readUInt16LE(8)
                };

                HidD_FreePreparsedData(ppd);
                CloseHandle(queryHandle);
                break;
              }
            }
            HidD_FreePreparsedData(ppd);
          }
          CloseHandle(queryHandle);
        }
      }
    }
    index++;
  }

  SetupDiDestroyDeviceInfoList(devInfo);
  return candidate;
}

// Initialize Sony XM5 Sensor via Feature Report 1
function configureDevice(handle) {
  const ppdPtr = [null];
  if (!HidD_GetPreparsedData(handle, ppdPtr)) {
    parentPort.postMessage({ type: 'log', message: 'Failed to get preparsed data: ' + GetLastError() });
    return false;
  }
  const ppd = ppdPtr[0];

  // HIDP_CAPS is 64 bytes
  const capsBuf = Buffer.alloc(64);
  const capsStatus = HidP_GetCaps(ppd, capsBuf);
  if (capsStatus !== HIDP_STATUS_SUCCESS) {
    HidD_FreePreparsedData(ppd);
    parentPort.postMessage({ type: 'log', message: 'HidP_GetCaps failed: ' + capsStatus.toString(16) });
    return false;
  }

  const usage = capsBuf.readUInt16LE(0);
  const usagePage = capsBuf.readUInt16LE(2);
  const inputLen = capsBuf.readUInt16LE(4);
  const featureLen = capsBuf.readUInt16LE(8);

  parentPort.postMessage({
    type: 'log',
    message: `HID CAPS: UsagePage=0x${usagePage.toString(16)}, Usage=0x${usage.toString(16)}, InputLen=${inputLen}, FeatureLen=${featureLen}`
  });

  const report = Buffer.alloc(featureLen > 0 ? featureLen : 40);
  report[0] = 0x01; // Report ID 1

  // 1. Encode Report Interval (40 ms)
  const setIntStatus = HidP_SetScaledUsageValue(HidP_Feature, SENSOR_PAGE, 0, USAGE_REPORT_INTERVAL, 40, ppd, report, report.length);
  parentPort.postMessage({ type: 'log', message: `SetScaledUsageValue (interval 40ms) status: 0x${setIntStatus.toString(16)}` });

  // 2. Encode Full Power (0x0851)
  const usagesToSet = [USAGE_POWER_FULL, USAGE_REPORTING_ALL_EVENTS];
  for (const u of usagesToSet) {
    const usageArr = new Uint16Array([u]);
    const countArr = [1];
    const setUStatus = HidP_SetUsages(HidP_Feature, SENSOR_PAGE, 0, usageArr, countArr, ppd, report, report.length);
    parentPort.postMessage({ type: 'log', message: `SetUsages (0x${u.toString(16)}) status: 0x${setUStatus.toString(16)}` });
  }

  HidD_FreePreparsedData(ppd);

  // Send Feature Report 1
  const success = HidD_SetFeature(handle, report, report.length);
  if (!success) {
    parentPort.postMessage({ type: 'log', message: `HidD_SetFeature failed: ${GetLastError()}` });
    return false;
  }

  parentPort.postMessage({ type: 'log', message: `Feature report 1 accepted by Sony XM5!` });
  return true;
}

// Math Helpers
function normalizeQuat(q) {
  const n = Math.hypot(q.w, q.x, q.y, q.z);
  if (n < 1e-12) return { w: 1, x: 0, y: 0, z: 0 };
  return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

function conjugateQuat(q) {
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

function multiplyQuat(a, b) {
  return normalizeQuat({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
  });
}

function rotationVectorToQuaternion(vx, vy, vz) {
  const angle = Math.hypot(vx, vy, vz);
  if (angle < 1e-12) return { w: 1, x: 0, y: 0, z: 0 };
  const s = Math.sin(angle / 2.0) / angle;
  return normalizeQuat({ w: Math.cos(angle / 2.0), x: vx * s, y: vy * s, z: vz * s });
}

function slerpQuat(a, b, t) {
  a = normalizeQuat(a);
  b = normalizeQuat(b);
  t = Math.max(0, Math.min(1, t));
  let dot = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  if (dot < 0) {
    b = { w: -b.w, x: -b.x, y: -b.y, z: -b.z };
    dot = -dot;
  }
  if (dot > 0.9995) {
    return normalizeQuat({
      w: a.w + t * (b.w - a.w),
      x: a.x + t * (b.x - a.x),
      y: a.y + t * (b.y - a.y),
      z: a.z + t * (b.z - a.z)
    });
  }
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return normalizeQuat({
    w: wa * a.w + wb * b.w,
    x: wa * a.x + wb * b.x,
    y: wa * a.y + wb * b.y,
    z: wa * a.z + wb * b.z
  });
}

function quatToEulerDegrees(q) {
  // Android head axes: X=right, Y=forward, Z=up. Yaw is around Z.
  const sinr = 2.0 * (q.w * q.x + q.y * q.z);
  const cosr = 1.0 - 2.0 * (q.x * q.x + q.y * q.y);
  const sinp = Math.max(-1.0, Math.min(1.0, 2.0 * (q.w * q.y - q.z * q.x)));
  const siny = 2.0 * (q.w * q.z + q.x * q.y);
  const cosy = 1.0 - 2.0 * (q.y * q.y + q.z * q.z);
  const rad2deg = 180.0 / Math.PI;
  return {
    yaw: Math.atan2(siny, cosy) * rad2deg,
    pitch: Math.asin(sinp) * rad2deg,
    roll: Math.atan2(sinr, cosr) * rad2deg
  };
}

// Main Polling & Reading Loop
async function run() {
  parentPort.postMessage({ type: 'status', state: 'searching', message: 'Scanning for head-tracking headset...' });

  while (isRunning) {
    const deviceInfo = findHeadTrackerDevice();
    if (!deviceInfo) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }

    parentPort.postMessage({
      type: 'status',
      state: 'connecting',
      deviceName: deviceInfo.productName,
      devicePath: deviceInfo.path
    });

    const widePath = stringToWide(deviceInfo.path);
    const handle = CreateFileW(
      widePath,
      GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE,
      null,
      OPEN_EXISTING,
      FILE_FLAG_OVERLAPPED,
      null
    );

    if (!handle || handle === INVALID_HANDLE_VALUE) {
      parentPort.postMessage({
        type: 'status',
        state: 'error',
        deviceName: deviceInfo.productName,
        message: 'Could not open device handle (error: ' + GetLastError() + ')'
      });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      continue;
    }

    activeHandle = handle;

    if (!configureDevice(handle)) {
      CloseHandle(handle);
      activeHandle = null;
      parentPort.postMessage({
        type: 'status',
        state: 'error',
        deviceName: deviceInfo.productName,
        message: `Failed to configure head tracking features on ${deviceInfo.productName}`
      });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      continue;
    }

    // Prepare overlapped reading
    const hEvent = CreateEventW(null, true, false, null);
    activeEvent = hEvent;

    const ov = {
      Internal: 0,
      InternalHigh: 0,
      Offset: 0,
      OffsetHigh: 0,
      hEvent: hEvent
    };

    parentPort.postMessage({
      type: 'status',
      state: 'streaming',
      deviceName: deviceInfo.productName,
      message: `Streaming head orientation from ${deviceInfo.productName}`
    });

    const inputReport = Buffer.alloc(14);
    const bytesTransferred = [0];

    while (isRunning) {
      ResetEvent(hEvent);
      bytesTransferred[0] = 0;

      const readSuccess = ReadFile(handle, inputReport, inputReport.length, bytesTransferred, ov);
      if (!readSuccess) {
        const err = GetLastError();
        if (err !== ERROR_IO_PENDING) {
          parentPort.postMessage({ type: 'status', state: 'disconnected', message: 'ReadFile error: ' + err });
          break;
        }

        const waitRes = WaitForSingleObject(hEvent, 200);
        if (waitRes !== WAIT_OBJECT_0) {
          if (!isRunning) break;
          // Timeout, wait again
          continue;
        }

        if (!GetOverlappedResult(handle, ov, bytesTransferred, false)) {
          const ovErr = GetLastError();
          parentPort.postMessage({ type: 'status', state: 'disconnected', message: 'GetOverlappedResult error: ' + ovErr });
          break;
        }
      }

      if (bytesTransferred[0] >= 7 && inputReport[0] === 0x01) {
        // Parse rotation vector from bytes 1..6 (three int16 little-endian)
        const rawX = inputReport.readInt16LE(1);
        const rawY = inputReport.readInt16LE(3);
        const rawZ = inputReport.readInt16LE(5);

        // Scale to radians (-pi .. +pi)
        const scale = Math.PI / 32767.0;
        const vx = rawX * scale;
        const vy = rawY * scale;
        const vz = rawZ * scale;

        const rawQuat = rotationVectorToQuaternion(vx, vy, vz);

        if (!filteredQuat) {
          filteredQuat = rawQuat;
          centerQuat = rawQuat;
        }

        if (recenterPending) {
          centerQuat = rawQuat;
          recenterPending = false;
        }

        // Smooth orientation
        filteredQuat = slerpQuat(filteredQuat, rawQuat, 0.25);

        // Compute orientation relative to center
        const relQuat = multiplyQuat(conjugateQuat(centerQuat), filteredQuat);
        const euler = quatToEulerDegrees(relQuat);

        parentPort.postMessage({
          type: 'pose',
          pose: {
            yaw: euler.yaw,
            pitch: euler.pitch,
            roll: euler.roll,
            raw: { x: vx, y: vy, z: vz },
            quaternion: [relQuat.w, relQuat.x, relQuat.y, relQuat.z]
          }
        });
      }
    }

    if (hEvent) CloseHandle(hEvent);
    if (handle) CloseHandle(handle);
    activeHandle = null;
    activeEvent = null;
    filteredQuat = null;
    centerQuat = null;

    if (isRunning) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  parentPort.postMessage({ type: 'status', state: 'stopped' });
}

run().catch((err) => {
  parentPort.postMessage({ type: 'error', error: err.message || String(err) });
});
