import com.google.zxing.NotFoundException;
import com.google.zxing.common.BitArray;
import com.google.zxing.oned.Code128Reader;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.util.*;
import javax.imageio.ImageIO;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;

/** Read the actual saved PDFs independently of the Spring renderer and its layout resources. */
public final class WorkPrintPdfCheck {
    static Set<String> scan(BufferedImage image) {
        var result = new TreeSet<String>();
        int w=image.getWidth();
        // Separate overlapping horizontal scanlines (document code and row code, cell rules).
        double[][] windows={{0,1},{.02,.36},{.44,.80},{.45,.96},{.77,.96},{.78,.97}};
        var reader=new Code128Reader();
        for (int y=3;y<image.getHeight();y+=7) {
            for (var window : windows) {
                int x=(int)(w*window[0]), length=(int)(w*window[1])-x;
                var bits=new BitArray(length);
                for (int i=0;i<length;i++) if ((image.getRGB(x+i,y)&255)<110) bits.set(i);
                try {result.add(reader.decodeRow(y,bits,null).getText());}
                catch (NotFoundException expected) {}
                catch (com.google.zxing.ReaderException invalid) {}
            }
        }
        return result;
    }
    static void require(boolean pass,String reason) {
        if (!pass) throw new AssertionError(reason);
    }
    public static void main(String[] args) throws Exception {
        var dir=Path.of(args[0]);
        try (var files=Files.list(dir)) {
            for (var file:files.filter(f->f.toString().endsWith(".pdf")).sorted().toList()) {
                String name=file.getFileName().toString().replace(".pdf","");
                String[] parts=name.split("-");
                int rows=Integer.parseInt(parts[1]);
                Set<String> all=new TreeSet<>();
                try(var doc=Loader.loadPDF(file.toFile())) {
                    var renderer=new PDFRenderer(doc);
                    for(int i=0;i<doc.getNumberOfPages();i++) {
                        var page=doc.getPage(i);
                        for (var box : List.of(page.getMediaBox(),page.getCropBox())) {
                            require(box.getLowerLeftX()==0 && box.getLowerLeftY()==0
                                && box.getWidth()==595 && box.getHeight()==842,name+" original page box");
                        }
                        for (var fontName:page.getResources().getFontNames())
                            require(page.getResources().getFont(fontName).isEmbedded(),name+" embedded font");
                        var img=renderer.renderImageWithDPI(i,240);
                        var decoded=scan(img);img.flush();require(!decoded.isEmpty(),name+" page "+i+" has readable code");all.addAll(decoded);
                        Path png=dir.resolve(name+"-"+(i+1)+".png");
                        {
                            var actual=ImageIO.read(png.toFile());var ref=renderer.renderImageWithDPI(i,110);
                            require(actual.getWidth()==ref.getWidth() && actual.getHeight()==ref.getHeight(),name+" dimensions");
                            for(int y=0;y<ref.getHeight();y++)
                                require(Arrays.equals(ref.getRGB(0,y,ref.getWidth(),1,null,0,ref.getWidth()),
                                        actual.getRGB(0,y,actual.getWidth(),1,null,0,actual.getWidth())),name+" preview pixels");
                            actual.flush();ref.flush();
                        }
                    }
                    String text=new PDFTextStripper().getText(doc);
                    require(text.matches("(?s).*[가-힣].*"),name+" Hangul text");
                    if(parts[0].equals("Multiple2")) {
                        var area=new org.apache.pdfbox.text.PDFTextStripperByArea();
                        area.addRegion("shipping",new java.awt.geom.Rectangle2D.Float(574*.72f,192*.72f,44*.72f,49*.72f));
                        area.extractRegions(doc.getPage(0));
                        require(area.getTextForRegion("shipping").trim().equals("0"),name+" first detail shipping zero");
                    }
                    var groupNumbers=Files.readAllLines(dir.resolve(name+".groups"));
                    if (!groupNumbers.isEmpty()) require(all.equals(new TreeSet<>(groupNumbers)),name+" barcode vs server group");
                    if(rows!=9) {
                        if (parts[0].equals("Single") || parts[0].equals("Multiple") || parts[0].equals("Multiple1")) {
                            for(int i=1;i<=rows;i++) require(all.contains("20261126"+i),name+" missing row barcode "+i+" "+all);
                            require(all.contains(parts[0].equals("Single")?"WPTEST000001":"WPTEST000001S"),name+" order barcode");
                            if(parts[0].equals("Multiple1")) require(all.contains("TEST-PO"),name+" original order barcode");
                        } else require(all.stream().anyMatch(s->s.matches("P[0-9]{14}")),name+" group barcode");
                    }
                    System.out.println(name+" pages="+doc.getNumberOfPages()+" embedded Korean, PNG match, decoded="+all);
                }
            }
        }
    }
}
