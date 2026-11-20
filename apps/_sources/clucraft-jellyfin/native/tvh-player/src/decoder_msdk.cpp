// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Robert Nisipeanu
// Modified 2026-11 by JustAnotherPU (GPL-3.0 section 5(a)) from github.com/robertnisipeanu/idrive-apps,
// native/waze-on-cluster/src/decoder_msdk.cpp.
// Copied 2026-11 for aurelm-tvhplayer (native/tvh-player): each frame carries its PicStruct (an interlaced stream is told).
// Modified 2026-11 for aurelm-emby (GPL-3.0 section 5(a)), from aurelm-airplay's copy (native/uxplay-mgu/video/src):
// frames in display order (films have B frames) and a film is fitted whole, never cropped.
// Modified 2026-11 for amn-iptv (GPL-3.0 section 5(a)): 10-bit HEVC (Main 10: most 4K films) decoded as P010 with the
// hardware's MSB alignment (Shift 1), converted to 8-bit NV12 by VPP. 0.3.6 (amn-iptv 0.3.6): the 10-bit decoder's
// surfaces in video memory from our own libva allocator (P010 render targets), height aligned to 32.
#include "decoder_msdk.h"
#include "nal_reader.h"

#include "mfx/mfxvideo.h"
int hevc_plugin(mfxSession s, void *plugin);   /* probe.cpp: the unit's HEVC decoder plugin into a session */

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <vector>

/* libva, from va/va.h and va/va_drm.h; the unit has libva.so.1 and
 * libva-drm.so.1 (1.9900.0). */
extern "C" {
typedef void *VADisplay;
typedef int VAStatus;
#define VA_STATUS_SUCCESS 0x00000000
VADisplay vaGetDisplayDRM(int fd);
VAStatus vaInitialize(VADisplay dpy, int *major_version, int *minor_version);
VAStatus vaTerminate(VADisplay dpy);
const char *vaErrorStr(VAStatus error_status);
/* amn-iptv: surfaces for the 10-bit decoder (va/va.h, VA-API 0.99: the unit's libva 1.9900) */
typedef unsigned int VASurfaceID;
typedef enum { VAGenericValueTypeInteger = 1 } VAGenericValueType;
typedef struct { VAGenericValueType type; union { int i; float f; void *p; void (*fn)(void); } value; } VAGenericValue;
typedef enum { VASurfaceAttribNone = 0, VASurfaceAttribPixelFormat = 1 } VASurfaceAttribType;
typedef struct { VASurfaceAttribType type; unsigned int flags; VAGenericValue value; } VASurfaceAttrib;
#define VA_SURFACE_ATTRIB_SETTABLE 0x00000002
#define VA_RT_FORMAT_YUV420 0x00000001
#define VA_RT_FORMAT_YUV420_10BPP 0x00000100
VAStatus vaCreateSurfaces(VADisplay dpy, unsigned int format, unsigned int width, unsigned int height, VASurfaceID *surfaces,
                          unsigned int num_surfaces, VASurfaceAttrib *attrib_list, unsigned int num_attribs);
VAStatus vaDestroySurfaces(VADisplay dpy, VASurfaceID *surfaces, int num_surfaces);
}

/* amn-iptv: Intel Media SDK 1.24's external frame allocator (mfxvideo.h / mfxstructures.h, MIT; the trimmed headers
 * here lack it). MFXVideoCORE_SetFrameAllocator is in the unit's libmfxhw64 (abi/libmfx.symbols). */
extern "C" {
typedef struct {
    mfxU32 AllocId;
    mfxU32 reserved[3];
    mfxMemId *mids;
    mfxU16 NumFrameActual;
    mfxU16 reserved2;
} mfxFrameAllocResponse;
typedef struct {
    mfxU32 reserved[4];
    mfxHDL pthis;
    mfxStatus (*Alloc)(mfxHDL pthis, mfxFrameAllocRequest *request, mfxFrameAllocResponse *response);
    mfxStatus (*Lock)(mfxHDL pthis, mfxMemId mid, mfxFrameData *ptr);
    mfxStatus (*Unlock)(mfxHDL pthis, mfxMemId mid, mfxFrameData *ptr);
    mfxStatus (*GetHDL)(mfxHDL pthis, mfxMemId mid, mfxHDL *handle);
    mfxStatus (*Free)(mfxHDL pthis, mfxFrameAllocResponse *response);
} mfxFrameAllocator;
mfxStatus MFXVideoCORE_SetFrameAllocator(mfxSession session, mfxFrameAllocator *allocator);
}
/* the request's Type bits (mfxstructures.h) */
const mfxU16 kMemDecoderTarget = 0x0010, kMemProcessorTarget = 0x0020, kMemFromDecode = 0x0200, kMemExternal = 0x0002;

namespace woc {

namespace {

const mfxU32 kSyncTimeoutMs = 1000;   /* longest wait for one frame */
const int kBusyRetries = 1000;        /* MFX_WRN_DEVICE_BUSY retries, 1 ms apart */
const int kStallLimit = 64;           /* decode calls in a row that neither output nor consume */

const char *status_name(mfxStatus s)
{
    switch (s) {
    case MFX_ERR_NONE: return "MFX_ERR_NONE";
    case MFX_ERR_UNKNOWN: return "MFX_ERR_UNKNOWN";
    case MFX_ERR_NULL_PTR: return "MFX_ERR_NULL_PTR";
    case MFX_ERR_UNSUPPORTED: return "MFX_ERR_UNSUPPORTED";
    case MFX_ERR_MEMORY_ALLOC: return "MFX_ERR_MEMORY_ALLOC";
    case MFX_ERR_NOT_ENOUGH_BUFFER: return "MFX_ERR_NOT_ENOUGH_BUFFER";
    case MFX_ERR_INVALID_HANDLE: return "MFX_ERR_INVALID_HANDLE";
    case MFX_ERR_LOCK_MEMORY: return "MFX_ERR_LOCK_MEMORY";
    case MFX_ERR_NOT_INITIALIZED: return "MFX_ERR_NOT_INITIALIZED";
    case MFX_ERR_NOT_FOUND: return "MFX_ERR_NOT_FOUND";
    case MFX_ERR_MORE_DATA: return "MFX_ERR_MORE_DATA";
    case MFX_ERR_MORE_SURFACE: return "MFX_ERR_MORE_SURFACE";
    case MFX_ERR_ABORTED: return "MFX_ERR_ABORTED";
    case MFX_ERR_DEVICE_LOST: return "MFX_ERR_DEVICE_LOST";
    case MFX_ERR_INCOMPATIBLE_VIDEO_PARAM: return "MFX_ERR_INCOMPATIBLE_VIDEO_PARAM";
    case MFX_ERR_INVALID_VIDEO_PARAM: return "MFX_ERR_INVALID_VIDEO_PARAM";
    case MFX_ERR_UNDEFINED_BEHAVIOR: return "MFX_ERR_UNDEFINED_BEHAVIOR";
    case MFX_ERR_DEVICE_FAILED: return "MFX_ERR_DEVICE_FAILED";
    case MFX_ERR_MORE_BITSTREAM: return "MFX_ERR_MORE_BITSTREAM";
    case MFX_ERR_INCOMPATIBLE_AUDIO_PARAM: return "MFX_ERR_INCOMPATIBLE_AUDIO_PARAM";
    case MFX_ERR_INVALID_AUDIO_PARAM: return "MFX_ERR_INVALID_AUDIO_PARAM";
    case MFX_ERR_GPU_HANG: return "MFX_ERR_GPU_HANG";
    case MFX_ERR_REALLOC_SURFACE: return "MFX_ERR_REALLOC_SURFACE";
    case MFX_WRN_IN_EXECUTION: return "MFX_WRN_IN_EXECUTION";
    case MFX_WRN_DEVICE_BUSY: return "MFX_WRN_DEVICE_BUSY";
    case MFX_WRN_VIDEO_PARAM_CHANGED: return "MFX_WRN_VIDEO_PARAM_CHANGED";
    case MFX_WRN_PARTIAL_ACCELERATION: return "MFX_WRN_PARTIAL_ACCELERATION";
    case MFX_WRN_INCOMPATIBLE_VIDEO_PARAM: return "MFX_WRN_INCOMPATIBLE_VIDEO_PARAM";
    case MFX_WRN_VALUE_NOT_CHANGED: return "MFX_WRN_VALUE_NOT_CHANGED";
    case MFX_WRN_OUT_OF_RANGE: return "MFX_WRN_OUT_OF_RANGE";
    case MFX_WRN_FILTER_SKIPPED: return "MFX_WRN_FILTER_SKIPPED";
    case MFX_WRN_INCOMPATIBLE_AUDIO_PARAM: return "MFX_WRN_INCOMPATIBLE_AUDIO_PARAM";
    }
    return "unknown status";
}

std::string mfx_error(const char *call, mfxStatus s)
{
    return std::string(call) + ": " + status_name(s) + " (" + std::to_string(s) + ")";
}

mfxU16 align16(uint32_t v) { return (mfxU16)((v + 15) & ~15u); }

/* amn-iptv: 10-bit 4:2:0 (the trimmed mfxstructures.h has no MFX_FOURCC_P010) and HEVC Main 10's profile number */
const mfxU32 kFourccP010 = MFX_MAKEFOURCC('P', '0', '1', '0');
const mfxU16 kProfileHevcMain10 = 2;
mfxU16 even(double v) { return (mfxU16)((uint32_t)(v + 0.5) & ~1u); }

const mfxU64 kNoTimeStamp = (mfxU64)-1;   /* MFX_TIMESTAMP_UNKNOWN */

int64_t ts_ms(mfxU64 ts) { return ts == kNoTimeStamp ? -1 : (int64_t)(ts / 90); }

void wrap(mfxBitstream *bs, const AccessUnit &au, int64_t pts_ms = -1)
{
    memset(bs, 0, sizeof *bs);
    bs->TimeStamp = pts_ms < 0 ? kNoTimeStamp : (mfxU64)pts_ms * 90;   /* MSDK counts 90 kHz */
    bs->Data = const_cast<mfxU8 *>(au.data);
    bs->DataLength = bs->MaxLength = (mfxU32)au.size;
    /* The reader only delivers whole access units, so the decoder need not
     * wait for the next start code to know the picture is complete. */
    bs->DataFlag = MFX_BITSTREAM_COMPLETE_FRAME;
}

}  // namespace

struct Decoder::State {
    int fd = -1;
    VADisplay va = nullptr;
    mfxSession session = nullptr;
    uint32_t out_w = 0, out_h = 0;   /* requested; 0 = the stream's size */
    bool fill = false;               /* crop to fill out_w x out_h instead of fitting inside */
    int64_t pts_ms = -1;             /* timestamp of the access units of this feed() */

    NalReader nal;
    bool hevc = false;                       /* mgu-moonlight: HEVC Main (the plugin, one per session) */
    alignas(16) unsigned char plugin[256];
    std::string error;               /* first hard error of the current call */
    int failed = 0;                  /* access units in a row that failed to decode */
    bool picture = true;             /* this call's frames get an atlas */

    /* The current sequence; valid while `running`. */
    bool running = false;
    mfxVideoParam dec, vpp;
    mfxExtOpaqueSurfaceAlloc dec_opaque, vpp_opaque;
    mfxExtBuffer *dec_ext[1], *vpp_ext[1];
    std::vector<mfxFrameSurface1> pool;          /* decoder output = VPP input; MSDK owns the memory */
    std::vector<mfxFrameSurface1 *> pool_ptrs;
    /* amn-iptv 0.3.6: video-memory surfaces from our own libva allocator (the 10-bit tries) */
    struct VaPool { std::vector<VASurfaceID> ids; std::vector<mfxMemId> mids; mfxU16 w = 0, h = 0; int refs = 0; };
    std::vector<std::unique_ptr<VaPool>> va_pools;
    mfxFrameAllocator allocator;
    std::string va_error;                        /* the last vaCreateSurfaces failure, for the screen */
    static mfxStatus va_alloc(mfxHDL pthis, mfxFrameAllocRequest *req, mfxFrameAllocResponse *resp);
    static mfxStatus va_lock(mfxHDL, mfxMemId, mfxFrameData *) { return MFX_ERR_UNSUPPORTED; }
    static mfxStatus va_gethdl(mfxHDL, mfxMemId mid, mfxHDL *handle) { if (!handle) return MFX_ERR_NULL_PTR; *handle = mid; return MFX_ERR_NONE; }
    static mfxStatus va_free(mfxHDL pthis, mfxFrameAllocResponse *resp);
    void va_release_all();
    mfxFrameSurface1 vout;                       /* VPP output, system memory */
    std::vector<uint8_t> vout_mem;
    mfxU16 crop_x = 0, crop_y = 0, crop_w = 0, crop_h = 0;   /* source rect VPP reads (fill) */
    uint32_t w = 0, h = 0;

    enum Result { Ok, Failed, Restart };

    ~State();
    bool open_session();
    void access_unit(const AccessUnit &au, const FrameSink &cb);
    bool start(const AccessUnit &au);
    bool configure(const mfxVideoParam &hdr, int variant);
    void stop();
    Result decode(mfxBitstream *bs, const FrameSink &cb);
    bool convert(mfxFrameSurface1 *in, const FrameSink &cb);
    bool skip(mfxFrameSurface1 *out, mfxSyncPoint sync, const FrameSink &cb);
    bool fail(const std::string &msg)
    {
        if (error.empty()) error = msg;
        return false;
    }
};

Decoder::State::~State()
{
    /* The session uses the VA display, so it closes first. */
    stop();
    if (va) vaTerminate(va);
    if (fd >= 0) close(fd);
}

bool Decoder::State::open_session()
{
    mfxVersion ver;
    ver.Major = MFX_VERSION_MAJOR;
    ver.Minor = MFX_VERSION_MINOR;
    /* GPU copy: VPP's output to system memory is copied by the GPU, not read
     * by a CPU thread from the tiled, uncached video surface (measured on
     * the unit: that thread took ~50 % of a core at 1280x720 30 fps).
     * YTDEC_GPUCOPY=0/1/2 overrides (default/on/off), for measuring. */
    mfxInitParam ip;
    memset(&ip, 0, sizeof ip);
    ip.Implementation = MFX_IMPL_HARDWARE | MFX_IMPL_VIA_VAAPI;
    ip.Version = ver;
    const char *gc = getenv("YTDEC_GPUCOPY");
    ip.GPUCopy = gc ? (mfxU16)atoi(gc) : (mfxU16)MFX_GPUCOPY_ON;
    mfxStatus sts = MFXInitEx(ip, &session);
    if (sts < MFX_ERR_NONE)
        sts = MFXInit(MFX_IMPL_HARDWARE | MFX_IMPL_VIA_VAAPI, &ver, &session);
    if (sts < MFX_ERR_NONE) {
        session = nullptr;
        return fail(mfx_error("MFXInit", sts));
    }
    /* On Linux the hardware library takes its device from the application
     * as a VA display (the unit's libNmeVideoMSDK imports vaGetDisplayDRM,
     * vaInitialize and MFXVideoCORE_SetHandle for the same purpose). */
    sts = MFXVideoCORE_SetHandle(session, MFX_HANDLE_VA_DISPLAY, va);
    if (sts < MFX_ERR_NONE) {
        MFXClose(session);
        session = nullptr;
        return fail(mfx_error("MFXVideoCORE_SetHandle", sts));
    }
    if (hevc) {
        const int r = hevc_plugin(session, plugin);
        if (r != 0) {
            MFXClose(session);
            session = nullptr;
            return fail("HEVC decoder plugin: " + std::to_string(r));
        }
    }
    return true;
}

void Decoder::State::access_unit(const AccessUnit &au, const FrameSink &cb)
{
    for (int attempt = 0; attempt < 2; attempt++) {
        if (!running) {
            if (!au.sps)
                return;   /* nothing decodes before a sequence header */
            if (!start(au)) {
                stop();
                return;
            }
            if (!running)
                return;
        }
        mfxBitstream bs;
        wrap(&bs, au, pts_ms);
        Result r = decode(&bs, cb);
        if (r == Ok) {
            failed = 0;
            return;
        }
        if (r == Failed) {
            if (++failed >= kFailLimit) {
                failed = 0;
                stop();
                error += "; " + std::to_string(kFailLimit) + " access units in a row failed: waiting for an SPS";
            }
            return;
        }
        /* The access unit starts a sequence that needs a larger picture or
         * more surfaces. Deliver what the old sequence still holds, then
         * reinitialise from this access unit. */
        decode(nullptr, cb);
        stop();
    }
    fail("decoder rejected the new sequence after reinitialising");
}

/* Every sequence gets a fresh session. Reinitialising decode and VPP with a
 * new opaque pool in the same session makes MSDK hand out output surfaces
 * from the closed pool (seen with the unit's libmfxsw64, the same MSDK
 * release as its libmfxhw64). */
bool Decoder::State::start(const AccessUnit &au)
{
    if (!session && !open_session())
        return false;

    /* DecodeHeader parses the SPS and PPS into dec.mfx: picture and crop
     * size, frame rate, profile. It moves only this local bitstream's offset;
     * decoding later starts from the whole access unit. */
    mfxBitstream bs;
    wrap(&bs, au);
    memset(&dec, 0, sizeof dec);
    dec.mfx.CodecId = hevc ? MFX_MAKEFOURCC('H', 'E', 'V', 'C') : MFX_CODEC_AVC;
    mfxStatus sts = MFXVideoDECODE_DecodeHeader(session, &bs, &dec);
    if (sts == MFX_ERR_MORE_DATA)
        return true;   /* SPS without its PPS: wait for the next SPS */
    if (sts < MFX_ERR_NONE)
        return fail(mfx_error("MFXVideoDECODE_DecodeHeader", sts));

    /* amn-iptv: 10-bit HEVC (Main 10: most 4K films). DecodeHeader names a P010 picture. 0.3.2 set it up one way
     * (P010, MSB-aligned: Shift 1, VPP to 8-bit NV12) and the car still decoded nothing, its error unseen. 0.3.3
     * tries each way this MSDK may want, every one on a fresh session (a failed Init leaves the session unsure),
     * and if none starts, the error names every try: the screen then says what the hardware refused. */
    const mfxVideoParam hdr = dec;
    const mfxFrameInfo &hf = hdr.mfx.FrameInfo;
    const bool ten = hf.FourCC == kFourccP010 || hf.BitDepthLuma > 8 || hf.BitDepthChroma > 8 ||
                     (hevc && hdr.mfx.CodecProfile == kProfileHevcMain10);
    if (!ten)
        return configure(hdr, 0);
    static const char *const kTries[] = {"video memory", "video memory, Shift 0", "opaque, height 64"};
    std::string tried;
    for (int v = 1; v <= 3; v++) {
        if (v > 1) {
            stop();
            if (!open_session())
                return false;
        }
        error.clear();
        if (configure(hdr, v)) {
            fprintf(stderr, "tvh-player: video: 10-bit %ux%u started (%s)\n", (unsigned)hf.CropW, (unsigned)hf.CropH, kTries[v - 1]);
            return true;
        }
        fprintf(stderr, "tvh-player: video: 10-bit try %s: %s\n", kTries[v - 1], error.c_str());
        tried += (tried.empty() ? "" : "; ") + std::string(kTries[v - 1]) + ": " + error;
    }
    error.clear();
    return fail("10-bit HEVC refused (" + tried + ")");
}

/* 0.3.4, from the car (0.3.3): every try failed in MFXVideoDECODE_Init with MFX_ERR_MEMORY_ALLOC - the P010 set-up is
 * accepted, the surfaces are not: a 3840x1608 P010 surface is twice an NV12 one, and the pool was the decoder's and
 * VPP's SUGGESTED counts (8-bit 4K fits, 10-bit did not). The tries now ask for less:
 *   1: P010 Shift 1, the decoder's and VPP's MINIMUM counts; 2: the decoder's minimum + 1 (VPP reads one at a time,
 *   synchronised: AsyncDepth 1); 3: as 2 with Shift 0. The error names the pool (count and size) of each try.
 * The decoder and VPP for one sequence, from DecodeHeader's parameters. variant (amn-iptv): 0 as they are (8-bit);
 * a 10-bit picture 1: P010 with Shift 1 (Intel's MSB alignment), 2: P010 with Shift 0, 3: as DecodeHeader gave it. */
bool Decoder::State::configure(const mfxVideoParam &hdr, int variant)
{
    dec = hdr;
    /* 0.3.6: 1 and 2 = video memory from our libva allocator (P010 render targets), Shift 1 / 0, height to 32;
     * 3 = opaque (MSDK's own surfaces), Shift 1, height to 64. */
    const bool video = variant == 1 || variant == 2;
    if (variant >= 1) {
        mfxFrameInfo &fi = dec.mfx.FrameInfo;
        fi.FourCC = kFourccP010;
        fi.ChromaFormat = MFX_CHROMAFORMAT_YUV420;
        if (fi.BitDepthLuma <= 8) fi.BitDepthLuma = 10;
        if (fi.BitDepthChroma <= 8) fi.BitDepthChroma = fi.BitDepthLuma;
        fi.Shift = variant == 2 ? 0 : 1;
        const uint32_t a = variant == 3 ? 63u : 31u;
        fi.Width = (mfxU16)((fi.Width + 15u) & ~15u);
        fi.Height = (mfxU16)((fi.Height + a) & ~a);
    }
    mfxStatus sts;
    if (video) {
        memset(&allocator, 0, sizeof allocator);
        allocator.pthis = this;
        allocator.Alloc = va_alloc;
        allocator.Lock = va_lock;
        allocator.Unlock = va_lock;
        allocator.GetHDL = va_gethdl;
        allocator.Free = va_free;
        sts = MFXVideoCORE_SetFrameAllocator(session, &allocator);
        if (sts < MFX_ERR_NONE)
            return fail(mfx_error("MFXVideoCORE_SetFrameAllocator", sts));
    }

    /* One frame in flight: lowest latency. */
    dec.AsyncDepth = 1;
    dec.IOPattern = video ? MFX_IOPATTERN_OUT_VIDEO_MEMORY : MFX_IOPATTERN_OUT_OPAQUE_MEMORY;
    /* aurelm-emby: display order. A film has B frames: the decoder holds
     * frames until their turn (its DPB), each comes out with its own
     * access unit's timestamp. */
    dec.mfx.DecodedOrder = 0;

    const mfxFrameInfo &in = dec.mfx.FrameInfo;
    w = out_w ? out_w : in.CropW;
    h = out_h ? out_h : in.CropH;

    memset(&vpp, 0, sizeof vpp);
    vpp.AsyncDepth = 1;
    vpp.IOPattern = (video ? MFX_IOPATTERN_IN_VIDEO_MEMORY : MFX_IOPATTERN_IN_OPAQUE_MEMORY) | MFX_IOPATTERN_OUT_SYSTEM_MEMORY;
    vpp.vpp.In = in;
    mfxFrameInfo &out = vpp.vpp.Out;
    out = in;
    out.FourCC = MFX_FOURCC_NV12;
    out.ChromaFormat = MFX_CHROMAFORMAT_YUV420;
    /* amn-iptv: the frame file is 8-bit, whatever the input (a 10-bit input's depth and Shift are not copied) */
    out.BitDepthLuma = out.BitDepthChroma = in.BitDepthLuma ? 8 : 0;
    out.Shift = 0;
    out.PicStruct = MFX_PICSTRUCT_PROGRESSIVE;
    out.Width = align16(w);
    out.Height = align16(h);
    out.CropX = out.CropY = 0;
    out.CropW = (mfxU16)w;
    out.CropH = (mfxU16)h;
    /* Fit or fill by display aspect (sample aspect ratio included, 0 = square). */
    crop_x = in.CropX, crop_y = in.CropY, crop_w = in.CropW, crop_h = in.CropH;
    if (out_w && in.CropW && in.CropH) {
        const double sar = in.AspectRatioW && in.AspectRatioH ? (double)in.AspectRatioW / in.AspectRatioH : 1.0;
        const double src = (double)in.CropW * sar / in.CropH, dst = (double)w / h;
        /* aurelm-emby: a film is fitted whole (black bars), cropped only with fill */
        if (fill) {
            if (src > dst) {
                crop_w = even(in.CropW * dst / src);
                crop_x = (mfxU16)(in.CropX + ((in.CropW - crop_w) / 2 & ~1u));
            } else {
                crop_h = even(in.CropH * src / dst);
                crop_y = (mfxU16)(in.CropY + ((in.CropH - crop_h) / 2 & ~1u));
            }
        } else {
            if (src > dst)
                out.CropH = even(w / src);
            else
                out.CropW = even(h * src);
            if (out.CropW < 2) out.CropW = 2;
            if (out.CropH < 2) out.CropH = 2;
            out.CropX = (mfxU16)((w - out.CropW) / 2 & ~1u);
            out.CropY = (mfxU16)((h - out.CropH) / 2 & ~1u);
        }
        vpp.vpp.In.CropX = crop_x, vpp.vpp.In.CropY = crop_y;
        vpp.vpp.In.CropW = crop_w, vpp.vpp.In.CropH = crop_h;
    }
    /* VPP needs a frame rate; the same one in and out means no frame rate
     * conversion. A stream without VUI timing gives none. */
    if (!in.FrameRateExtN || !in.FrameRateExtD) {
        vpp.vpp.In.FrameRateExtN = out.FrameRateExtN = 30;
        vpp.vpp.In.FrameRateExtD = out.FrameRateExtD = 1;
    }

    /* Decoder output surfaces are VPP input surfaces, so one pool serves both
     * and has to cover both components' suggested counts. */
    mfxFrameAllocRequest dec_req, vpp_req[2];
    memset(&dec_req, 0, sizeof dec_req);
    memset(vpp_req, 0, sizeof vpp_req);
    sts = MFXVideoDECODE_QueryIOSurf(session, &dec, &dec_req);
    if (sts < MFX_ERR_NONE)
        return fail(mfx_error("MFXVideoDECODE_QueryIOSurf", sts));
    sts = MFXVideoVPP_QueryIOSurf(session, &vpp, vpp_req);
    if (sts < MFX_ERR_NONE)
        return fail(mfx_error("MFXVideoVPP_QueryIOSurf", sts));
    mfxU16 n = (mfxU16)(dec_req.NumFrameSuggested + vpp_req[0].NumFrameSuggested);
    if (variant >= 1) n = (mfxU16)(dec_req.NumFrameMin + vpp_req[0].NumFrameMin);
    if (n < dec_req.NumFrameMin + 1) n = (mfxU16)(dec_req.NumFrameMin + 1);
    const std::string poolDesc = " (" + std::to_string(n) + " surfaces " + std::to_string(in.Width) + "x" + std::to_string(in.Height) +
                             ", decoder min " + std::to_string(dec_req.NumFrameMin) + " / suggested " + std::to_string(dec_req.NumFrameSuggested) + ")";

    /* Opaque surfaces: the application passes surface headers only, and MSDK
     * allocates the memory behind them when the decoder is initialised. VPP
     * is given the same headers as its input. 0.3.6: in video memory, the
     * surfaces are ours (va_alloc), each header naming its VA surface. */
    pool.assign(n, mfxFrameSurface1());
    pool_ptrs.resize(n);
    mfxFrameAllocResponse resp;
    memset(&resp, 0, sizeof resp);
    if (video) {
        mfxFrameAllocRequest req = dec_req;
        req.NumFrameMin = req.NumFrameSuggested = n;
        req.Type = (mfxU16)(req.Type | kMemExternal | kMemFromDecode | kMemDecoderTarget);
        va_error.clear();
        sts = va_alloc(this, &req, &resp);
        if (sts < MFX_ERR_NONE)
            return fail("our P010 surfaces: " + (va_error.empty() ? mfx_error("alloc", sts) : va_error) + poolDesc);
    }
    for (mfxU16 i = 0; i < n; i++) {
        pool[i].Info = in;
        if (video) pool[i].Data.MemId = resp.mids[i];
        pool_ptrs[i] = &pool[i];
    }
    memset(&dec_opaque, 0, sizeof dec_opaque);
    dec_opaque.Header.BufferId = MFX_EXTBUFF_OPAQUE_SURFACE_ALLOCATION;
    dec_opaque.Header.BufferSz = sizeof dec_opaque;
    dec_opaque.Out.Surfaces = pool_ptrs.data();
    dec_opaque.Out.NumSurface = n;
    dec_opaque.Out.Type = dec_req.Type;
    memset(&vpp_opaque, 0, sizeof vpp_opaque);
    vpp_opaque.Header = dec_opaque.Header;
    vpp_opaque.In = dec_opaque.Out;
    dec_ext[0] = &dec_opaque.Header;
    vpp_ext[0] = &vpp_opaque.Header;
    dec.ExtParam = video ? nullptr : dec_ext;
    dec.NumExtParam = video ? 0 : 1;
    vpp.ExtParam = video ? nullptr : vpp_ext;
    vpp.NumExtParam = video ? 0 : 1;

    sts = MFXVideoDECODE_Init(session, &dec);
    if (sts < MFX_ERR_NONE)
        return fail(mfx_error("MFXVideoDECODE_Init", sts) + poolDesc + (va_error.empty() ? "" : "; " + va_error));
    sts = MFXVideoVPP_Init(session, &vpp);
    if (sts < MFX_ERR_NONE) {
        MFXVideoDECODE_Close(session);
        return fail(mfx_error("MFXVideoVPP_Init", sts) + poolDesc);
    }

    /* One output surface suffices: each VPP run is synchronised before the
     * next. NV12 is the Y plane, then U,V interleaved at half size. */
    memset(&vout, 0, sizeof vout);
    vout.Info = out;
    mfxU32 pitch = out.Width;
    vout_mem.assign((size_t)pitch * out.Height * 3 / 2, 0);
    vout.Data.Y = vout_mem.data();
    vout.Data.UV = vout.Data.Y + (size_t)pitch * out.Height;
    vout.Data.Pitch = (mfxU16)pitch;
    /* Black (BT.709 limited) where VPP does not write: the letterbox bars. */
    memset(vout.Data.Y, 16, (size_t)pitch * out.Height);
    memset(vout.Data.UV, 128, (size_t)pitch * out.Height / 2);
    running = true;
    return true;
}

void Decoder::State::stop()
{
    if (running) {
        MFXVideoDECODE_Close(session);
        MFXVideoVPP_Close(session);
        running = false;
    }
    if (session) {
        MFXClose(session);
        session = nullptr;
    }
    pool.clear();
    pool_ptrs.clear();
    va_release_all();
}

/* amn-iptv 0.3.6: the external allocator. The decoder's own Init asks again for the pool configure() made (the
 * request FROM_DECODE): it gets the same surfaces back, as Intel's samples do. Anything else in video memory gets new
 * surfaces; system memory is not ours (MFX_ERR_UNSUPPORTED: MSDK allocates it itself). */
mfxStatus Decoder::State::va_alloc(mfxHDL pthis, mfxFrameAllocRequest *req, mfxFrameAllocResponse *resp)
{
    State *st = static_cast<State *>(pthis);
    if (!st || !req || !resp)
        return MFX_ERR_NULL_PTR;
    if (!(req->Type & (kMemDecoderTarget | kMemProcessorTarget)))
        return MFX_ERR_UNSUPPORTED;
    const mfxFrameInfo &fi = req->Info;
    unsigned rt;
    if (fi.FourCC == kFourccP010) rt = VA_RT_FORMAT_YUV420_10BPP;
    else if (fi.FourCC == MFX_FOURCC_NV12) rt = VA_RT_FORMAT_YUV420;
    else return MFX_ERR_UNSUPPORTED;
    if (req->Type & kMemFromDecode)
        for (auto &p : st->va_pools)
            if (p->refs > 0 && p->ids.size() >= req->NumFrameMin && p->w >= fi.Width && p->h >= fi.Height) {
                p->refs++;
                resp->mids = p->mids.data();
                resp->NumFrameActual = (mfxU16)p->mids.size();
                return MFX_ERR_NONE;
            }
    const unsigned n = req->NumFrameSuggested > req->NumFrameMin ? req->NumFrameSuggested : req->NumFrameMin;
    if (!n)
        return MFX_ERR_MEMORY_ALLOC;
    std::unique_ptr<VaPool> p(new VaPool);
    p->ids.assign(n, 0);
    VASurfaceAttrib attr;
    memset(&attr, 0, sizeof attr);
    attr.type = VASurfaceAttribPixelFormat;
    attr.flags = VA_SURFACE_ATTRIB_SETTABLE;
    attr.value.type = VAGenericValueTypeInteger;
    attr.value.value.i = (int)fi.FourCC;   /* VA_FOURCC_P010 / VA_FOURCC_NV12: the same four characters */
    const VAStatus vs = vaCreateSurfaces(st->va, rt, fi.Width, fi.Height, p->ids.data(), n, &attr, 1);
    if (vs != VA_STATUS_SUCCESS) {
        st->va_error = std::string("vaCreateSurfaces ") + (rt == VA_RT_FORMAT_YUV420_10BPP ? "P010 " : "NV12 ") + std::to_string(n) + "x " +
                       std::to_string(fi.Width) + "x" + std::to_string(fi.Height) + ": " + vaErrorStr(vs) + " (" + std::to_string(vs) + ")";
        return MFX_ERR_MEMORY_ALLOC;
    }
    p->mids.resize(n);
    for (unsigned i = 0; i < n; i++) p->mids[i] = &p->ids[i];   /* GetHDL hands MSDK the VASurfaceID* */
    p->w = fi.Width, p->h = fi.Height, p->refs = 1;
    resp->mids = p->mids.data();
    resp->NumFrameActual = (mfxU16)n;
    st->va_pools.push_back(std::move(p));
    return MFX_ERR_NONE;
}

mfxStatus Decoder::State::va_free(mfxHDL pthis, mfxFrameAllocResponse *resp)
{
    State *st = static_cast<State *>(pthis);
    if (!st || !resp)
        return MFX_ERR_NULL_PTR;
    for (size_t i = 0; i < st->va_pools.size(); i++) {
        VaPool &p = *st->va_pools[i];
        if (p.mids.data() != resp->mids) continue;
        if (--p.refs <= 0) {
            vaDestroySurfaces(st->va, p.ids.data(), (int)p.ids.size());
            st->va_pools.erase(st->va_pools.begin() + i);
        }
        return MFX_ERR_NONE;
    }
    return MFX_ERR_INVALID_HANDLE;
}

void Decoder::State::va_release_all()
{
    for (auto &p : va_pools)
        if (!p->ids.empty()) vaDestroySurfaces(va, p->ids.data(), (int)p->ids.size());
    va_pools.clear();
}

/* Decodes everything in bs, or with bs null drains the frames the decoder
 * holds, until MSDK asks for more data. */
Decoder::State::Result Decoder::State::decode(mfxBitstream *bs, const FrameSink &cb)
{
    int busy = 0, stalls = 0;
    for (;;) {
        mfxFrameSurface1 *work = nullptr;
        for (auto &s : pool) {
            if (!s.Data.Locked) {
                work = &s;
                break;
            }
        }
        if (!work) {
            fail("no free decode surface");
            return Failed;
        }
        mfxFrameSurface1 *out = nullptr;
        mfxSyncPoint sync = nullptr;
        mfxStatus sts = MFXVideoDECODE_DecodeFrameAsync(session, bs, work, &out, &sync);
        if (sts == MFX_WRN_DEVICE_BUSY) {
            if (++busy > kBusyRetries) {
                fail(mfx_error("MFXVideoDECODE_DecodeFrameAsync", sts));
                return Failed;
            }
            usleep(1000);
            continue;
        }
        busy = 0;
        if (sts == MFX_ERR_MORE_DATA)
            return Ok;
        if (sts == MFX_ERR_INCOMPATIBLE_VIDEO_PARAM && bs)
            return Restart;
        if (sts < MFX_ERR_NONE && sts != MFX_ERR_MORE_SURFACE) {
            fail(mfx_error("MFXVideoDECODE_DecodeFrameAsync", sts));
            return Failed;
        }
        /* MFX_ERR_MORE_SURFACE: the decoder kept `work` as a reference and
         * wants another. MFX_ERR_NONE or a warning such as
         * MFX_WRN_VIDEO_PARAM_CHANGED (a repeated or compatible SPS) may come
         * with a frame; with no frame the call is repeated. */
        if (sync) {
            stalls = 0;
            if (!(picture ? convert(out, cb) : skip(out, sync, cb)))
                return Failed;
        } else if (++stalls > kStallLimit) {
            fail(mfx_error("MFXVideoDECODE_DecodeFrameAsync makes no progress", sts));
            return Failed;
        }
    }
}

/* Runs VPP on a decoded surface and hands the packed atlas to cb. The VPP
 * task depends on the decode task in the same session, so waiting for VPP
 * waits for both. */
bool Decoder::State::convert(mfxFrameSurface1 *in, const FrameSink &cb)
{
    mfxSyncPoint sync = nullptr;
    mfxStatus sts;
    int busy = 0;
    /* VPP reads the input surface's crop: the decoder set it to the picture's. */
    in->Info.CropX = crop_x, in->Info.CropY = crop_y, in->Info.CropW = crop_w, in->Info.CropH = crop_h;
    while ((sts = MFXVideoVPP_RunFrameVPPAsync(session, in, &vout, nullptr, &sync)) == MFX_WRN_DEVICE_BUSY) {
        if (++busy > kBusyRetries)
            return fail(mfx_error("MFXVideoVPP_RunFrameVPPAsync", sts));
        usleep(1000);
    }
    if (sts == MFX_ERR_MORE_DATA)
        return true;   /* VPP holds the input for a later output (deinterlacing) */
    if (sts < MFX_ERR_NONE)
        return fail(mfx_error("MFXVideoVPP_RunFrameVPPAsync", sts));
    if (!sync)
        return true;
    sts = MFXVideoCORE_SyncOperation(session, sync, kSyncTimeoutMs);
    if (sts != MFX_ERR_NONE)
        return fail(mfx_error("MFXVideoCORE_SyncOperation", sts));

    /* The decode task finished before the VPP task that read its surface,
     * so its flags are set. */
    VideoFrame f = {w, h, in->Data.Corrupted, ts_ms(in->Data.TimeStamp), in->Info.PicStruct, vout.Data.Y, vout.Data.UV, vout.Data.Pitch};
    cb(f);
    return true;
}

/* A frame without a picture: no VPP. The wait costs nothing the next frame
 * would not wait for anyway (it refers to this one, and AsyncDepth 1 holds
 * its decode until this one's is done), and it sets the Corrupted flags.
 * Nothing holds the surface for VPP, so the decoder frees it once it is no
 * longer a reference. */
bool Decoder::State::skip(mfxFrameSurface1 *out, mfxSyncPoint sync, const FrameSink &cb)
{
    const mfxStatus sts = MFXVideoCORE_SyncOperation(session, sync, kSyncTimeoutMs);
    if (sts != MFX_ERR_NONE)
        return fail(mfx_error("MFXVideoCORE_SyncOperation", sts));
    VideoFrame f = {w, h, out->Data.Corrupted, ts_ms(out->Data.TimeStamp), out->Info.PicStruct, nullptr, nullptr, 0};
    cb(f);
    return true;
}

Decoder::Decoder() {}

Decoder::~Decoder() { shutdown(); }

bool Decoder::init(const char *dev, uint32_t out_w, uint32_t out_h, bool fill, std::string *err, bool hevc)
{
    shutdown();
    if ((out_w == 0) != (out_h == 0)) {
        *err = "out_w and out_h must both be 0 or both be set";
        return false;
    }
    if (out_w % 2 || out_h % 2) {
        *err = "4:2:0 output needs an even out_w and out_h";
        return false;
    }
    std::unique_ptr<State> s(new State);
    s->out_w = out_w;
    s->out_h = out_h;
    s->fill = fill;
    s->hevc = hevc;

    s->fd = open(dev, O_RDWR | O_CLOEXEC);
    if (s->fd < 0) {
        *err = std::string("open ") + dev + ": " + strerror(errno);
        return false;
    }
    s->va = vaGetDisplayDRM(s->fd);
    if (!s->va) {
        *err = "vaGetDisplayDRM failed";
        return false;
    }
    int major = 0, minor = 0;
    VAStatus vs = vaInitialize(s->va, &major, &minor);
    if (vs != VA_STATUS_SUCCESS) {
        *err = std::string("vaInitialize: ") + vaErrorStr(vs);
        return false;
    }

    /* Opened now to report a missing or refusing MSDK early; the first
     * sequence uses it. */
    if (!s->open_session()) {
        *err = s->error;
        return false;
    }
    s_ = std::move(s);
    return true;
}

bool Decoder::feed(const uint8_t *data, size_t len, const FrameSink &cb, std::string *err, bool end_of_au,
                   bool picture, int64_t pts_ms)
{
    if (!s_) {
        *err = "decoder not initialised";
        return false;
    }
    State &s = *s_;
    s.error.clear();
    s.picture = picture;
    s.pts_ms = pts_ms;
    if (s.hevc) {   /* mgu-moonlight hands whole frames: no H.264 framing, only VPS/SPS (33) and IRAP (19-21) */
        AccessUnit au = {data, len, false, false, false};
        for (size_t i = 0; i + 3 < len; i++)
            if (data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1) {
                const int t = (data[i + 3] >> 1) & 0x3f;
                au.sps |= t == 33;
                au.idr |= t >= 19 && t <= 21;
                i += 2;
            }
        s.access_unit(au, cb);
    } else
        s.nal.push(data, len, end_of_au, [&](const AccessUnit &au) { s.access_unit(au, cb); });
    if (!s.error.empty()) {
        *err = s.error;
        return false;
    }
    return true;
}

void Decoder::flush(const FrameSink &cb)
{
    if (!s_)
        return;
    State &s = *s_;
    s.picture = true;
    s.nal.flush([&](const AccessUnit &au) { s.access_unit(au, cb); });
    if (s.running)
        s.decode(nullptr, cb);
    s.stop();
    s.error.clear();
}

void Decoder::shutdown() { s_.reset(); }

bool Decoder::decoding() const { return s_ && s_->running; }

}  // namespace woc
