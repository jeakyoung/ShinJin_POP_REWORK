package com.shinjin.pop.output;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.WriterException;
import com.google.zxing.oned.Code128Writer;
import com.google.zxing.qrcode.QRCodeWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Source units: barcode = tenths of mm; QR = hundredths of an inch. */
@Component
@Profile("demo")
public final class EmployeeReportRenderer {
    private final String logo;

    public EmployeeReportRenderer() throws IOException {
        byte[] bytes = new ClassPathResource("employee-print/logo.gif").getContentAsByteArray();
        logo = "data:image/gif;base64," + Base64.getEncoder().encodeToString(bytes);
    }

    public List<byte[]> render(EmployeePrintController.Form form, String plant,
                               List<EmployeePrintController.Employee> selected) {
        if (form == EmployeePrintController.Form.QR) return qrPages(plant, selected);
        return barcodePages(plant, selected);
    }

    private static final class Pages {
        final int width, height;
        final double top, bottom;
        final List<byte[]> images = new ArrayList<>();
        final StringBuilder body = new StringBuilder();
        double y;

        Pages(int width, int height, double top, double bottom) {
            this.width = width; this.height = height; this.top = top; this.bottom = bottom; y = top;
        }

        double band(double size) {
            if (y + size > height - bottom) {
                finish();
                y = top;
            }
            double start = y;
            y += size;
            return start;
        }

        void finish() {
            String svg = "<svg xmlns='http://www.w3.org/2000/svg' width='994' height='1405' viewBox='0 0 "
                    + width + " " + height + "'><rect width='100%' height='100%' fill='white'/>" + body + "</svg>";
            images.add(svg.getBytes(StandardCharsets.UTF_8));
            body.setLength(0);
        }
    }

    private List<byte[]> barcodePages(String plant, List<EmployeePrintController.Employee> employees) {
        Pages pages = new Pages(2100, 2970, 100, 100);
        double header = pages.band(254);
        text(pages.body, 100, header, 1900, 127, plant, "Arial", 24 * 254.0 / 72, false);
        var sorted = employees.stream().sorted(Comparator.comparing(EmployeePrintController.Employee::department)).toList();
        for (var employee : sorted) {
            double y = pages.band(134);
            boolean[] bars;
            try { bars = new Code128Writer().encode(employee.id()); }
            catch (IllegalArgumentException e) { throw invalidSymbol(); }
            for (int column = 0; column < 2; column++) {
                double left = 100 + 950 * column;
                box(pages.body, left, y, 625.81, 134, 2.1);
                box(pages.body, left + 625.81, y, 324.19, 134, 2.1);
                double x = left + 25 + 26;
                double module = (578.04 - 52) / bars.length;
                StringBuilder path = new StringBuilder();
                for (int i = 0; i < bars.length;) {
                    if (!bars[i]) { i++; continue; }
                    int start = i++;
                    while (i < bars.length && bars[i]) i++;
                    path.append("M").append(x + start * module).append(' ').append(y + 4.83)
                            .append('h').append((i - start) * module).append("v94h-")
                            .append((i - start) * module).append('z');
                }
                pages.body.append("<path shape-rendering='crispEdges' d='").append(path).append("'/>");
                text(pages.body, left + 25, y + 98, 578.04, 31, employee.id(), "Arial", 8 * 254.0 / 72, false);
                text(pages.body, left + 625.81, y, 324.19, 134, employee.name(), "Arial", 20 * 254.0 / 72, false);
            }
            pages.band(130); // The original includes a separate blank table after each label row.
        }
        pages.finish();
        return pages.images;
    }

    private List<byte[]> qrPages(String plant, List<EmployeePrintController.Employee> employees) {
        Pages pages = new Pages(827, 1169, 38.54167, 37.5);
        text(pages.body, 24, pages.band(50), 650, 50, plant, "Arial", 24 * 100.0 / 72, false);
        double y = 0;
        for (int i = 0; i < employees.size(); i++) {
            if (i % 2 == 0) y = pages.band(125.9);
            double left = 24 + (i % 2) * 388.5;
            var employee = employees.get(i);
            box(pages.body, left + 66, y + 7, 268, 113.4, 0.83);
            pages.body.append("<path stroke='black' stroke-width='.83' d='M").append(left + 226.2)
                    .append(' ').append(y + 7).append("v113.4'/>");
            pages.body.append("<image href='").append(logo).append("' x='").append(left + 68)
                    .append("' y='").append(y + 9).append("' width='154.64' height='22.26'/>");
            text(pages.body, left + 66, y + 33.34167, 160.2, 43.53, employee.departmentName(), "Malgun Gothic", 20 * 100.0 / 72, true);
            text(pages.body, left + 66, y + 76.87167, 160.2, 43.53, employee.name(), "Malgun Gothic", 20 * 100.0 / 72, true);
            qr(pages.body, employee.id(), left + 226.2, y + 9);
        }
        pages.finish();
        return pages.images;
    }

    private static void qr(StringBuilder out, String value, double x, double y) {
        try {
            var matrix = new QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 0, 0,
                    Map.of(EncodeHintType.MARGIN, 1, EncodeHintType.CHARACTER_SET, "UTF-8"));
            int size = matrix.getWidth();
            out.append("<svg x='").append(x).append("' y='").append(y).append("' width='105.7167' height='107.975' viewBox='0 0 ")
                    .append(size).append(' ').append(size).append("'><path shape-rendering='crispEdges' d='");
            for (int row = 0; row < size; row++)
                for (int col = 0; col < size; col++)
                    if (matrix.get(col,row)) out.append('M').append(col).append(' ').append(row).append("h1v1h-1z");
            out.append("'/></svg>");
        } catch (WriterException | IllegalArgumentException ex) { throw invalidSymbol(); }
    }

    private static void box(StringBuilder out, double x, double y, double w, double h, double stroke) {
        out.append("<rect fill='none' stroke='black' stroke-width='").append(stroke).append("' x='")
                .append(x).append("' y='").append(y).append("' width='").append(w).append("' height='").append(h).append("'/>");
    }

    private static void text(StringBuilder out, double x, double y, double w, double h, String value,
                             String font, double size, boolean bold) {
        String escaped = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
        out.append("<svg x='").append(x).append("' y='").append(y).append("' width='").append(w)
                .append("' height='").append(h).append("'><text x='50%' y='50%' text-anchor='middle' dominant-baseline='central' font-family='")
                .append(font).append("' font-size='").append(size).append("' font-weight='")
                .append(bold ? "bold" : "normal").append("'>").append(escaped).append("</text></svg>");
    }

    private static ResponseStatusException invalidSymbol() {
        return new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "Employee number cannot be encoded");
    }
}
