package local.mcbridge;
import java.nio.*;
import java.nio.file.*;
import javax.imageio.ImageIO;
public class CaptureCoreTest {
    public static void main(String[] args) throws Exception {
        CapturePlan p=CapturePlan.of(1920,1080,10,2000,false);
        require(p.count()==20 && p.slot(99_999_999)==0 && p.slot(100_000_000)==1 && p.slot(399_999_999)==3,"monotonic slots");
        require(CapturePlan.of(3840,2160,10,2000,true).count()==1,"4K single");
        reject(()->CapturePlan.of(3840,2160,30,10000,false));
        reject(()->CapturePlan.of(1920,1080,30,10000,false));
        reject(()->CapturePlan.of(0,1080,10,2000,false));
        reject(()->CapturePlan.of(1920,1080,0,2000,false));
        // Round-trip odd-width RGBA, alpha, negative byte values, Sub filtering and row boundaries.
        ByteBuffer rgba=ByteBuffer.allocateDirect(24);
        byte[] values={(byte)255,0,0,(byte)255,0,(byte)255,0,(byte)128,0,0,(byte)255,0,17,32,65,99,33,44,55,(byte)255,0,0,0,(byte)255};rgba.put(values).flip();
        Path file=Path.of(args[0]);FastPng.write(rgba,3,2,file);
        var image=ImageIO.read(file.toFile());require(image.getWidth()==3&&image.getHeight()==2,"dimensions");
        for(int i=0;i<6;i++){int o=i*4,expected=((values[o+3]&255)<<24)|((values[o]&255)<<16)|((values[o+1]&255)<<8)|(values[o+2]&255);require(image.getRGB(i%3,i/3)==expected,"RGBA preserved at "+i);}
        require(rgba.position()==0,"caller buffer unchanged");System.out.println("Capture schedule and lossless PNG round-trip passed");
    }
    private static void require(boolean value,String message){if(!value)throw new AssertionError(message);}
    private static void reject(Runnable f){try{f.run();}catch(IllegalArgumentException e){return;}throw new AssertionError("Expected rejection");}
}
