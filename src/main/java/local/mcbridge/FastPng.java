package local.mcbridge;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.file.*;
import java.util.zip.*;

/** Lossless RGBA PNG with a cheap Sub filter and fast deflate, without global STB settings. */
public final class FastPng {
    public static void write(ByteBuffer pixels,int width,int height,Path file) throws IOException {
        int stride=Math.multiplyExact(width,4);
        ByteBuffer rgba=pixels.duplicate();
        if(width<=0||height<=0||rgba.remaining()!=(long)stride*height)throw new IllegalArgumentException("RGBA buffer size mismatch");
        ByteArrayOutputStream compressed=new ByteArrayOutputStream();
        Deflater deflater=new Deflater(Deflater.BEST_SPEED);
        try(DeflaterOutputStream zip=new DeflaterOutputStream(compressed,deflater,65536)) {
            byte[] raw=new byte[stride],filtered=new byte[stride+1];filtered[0]=1;
            for(int y=0;y<height;y++) {
                rgba.get(raw);
                for(int x=0;x<stride;x++)filtered[x+1]=(byte)(raw[x]-(x<4?0:raw[x-4]));
                zip.write(filtered);
            }
        } finally {deflater.end();}
        try(DataOutputStream out=new DataOutputStream(new BufferedOutputStream(Files.newOutputStream(file)))) {
            out.writeLong(0x89504e470d0a1a0aL);
            ByteArrayOutputStream header=new ByteArrayOutputStream();
            DataOutputStream h=new DataOutputStream(header);h.writeInt(width);h.writeInt(height);h.write(new byte[]{8,6,0,0,0});
            chunk(out,"IHDR",header.toByteArray());chunk(out,"IDAT",compressed.toByteArray());chunk(out,"IEND",new byte[0]);
        }
    }
    private static void chunk(DataOutputStream out,String type,byte[] bytes) throws IOException {
        byte[] name=type.getBytes(java.nio.charset.StandardCharsets.US_ASCII);CRC32 crc=new CRC32();crc.update(name);crc.update(bytes);
        out.writeInt(bytes.length);out.write(name);out.write(bytes);out.writeInt((int)crc.getValue());
    }
}
