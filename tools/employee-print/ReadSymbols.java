import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;
import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.List;
import java.util.Map;

/** Decodes each physical label position in the native reference and the Chrome raster. */
public class ReadSymbols {
    static void read(BufferedImage page, int x, int y, int w, int h, BarcodeFormat format, String expected) throws Exception {
        BufferedImage crop = new BufferedImage(w + 48, h + 48, BufferedImage.TYPE_INT_RGB);
        var g = crop.createGraphics();
        g.setColor(Color.WHITE); g.fillRect(0,0,crop.getWidth(),crop.getHeight());
        g.drawImage(page.getSubimage(x,y,w,h),24,24,null); g.dispose();
        int width = crop.getWidth(), height = crop.getHeight();
        var source = new RGBLuminanceSource(width,height,crop.getRGB(0,0,width,height,null,0,width));
        var actual = new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(source)),
                Map.of(DecodeHintType.POSSIBLE_FORMATS, List.of(format), DecodeHintType.TRY_HARDER, true));
        if (!expected.equals(actual.getText())) throw new AssertionError("Unexpected symbol payload");
    }

    public static void main(String[] args) throws Exception {
        var qr = ImageIO.read(new File(args[0]));
        var bar = ImageIO.read(new File(args[1]));
        if (qr.getWidth()!=994 || qr.getHeight()!=1405 || bar.getWidth()!=994 || bar.getHeight()!=1405) throw new AssertionError("A4 size");
        for(int i=0;i<2;i++){
            read(qr,301+466*i,119,129,129,BarcodeFormat.QR_CODE,args[2+i]);
            for(int col=0;col<2;col++)
                read(bar,54+449*col,174+125*i,280,36,BarcodeFormat.CODE_128,args[2+i]);
        }
        System.out.println("PASS A4/2 QR and 4 Code128 labels at native coordinates");
    }
}
