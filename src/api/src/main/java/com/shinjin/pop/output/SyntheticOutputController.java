package com.shinjin.pop.output;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;

import java.util.List;

import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("demo")
@RequestMapping("/api/demo/output")
public class SyntheticOutputController {
    private final SyntheticOutput renderer;

    public SyntheticOutputController(SyntheticOutput renderer) {
        this.renderer = renderer;
    }

    @GetMapping
    public List<SyntheticOutput.Example> examples(HttpServletRequest request) {
        DemoSessionController.requireIdentity(request);
        return renderer.examples();
    }

    @GetMapping("/{id}/{step}")
    public ResponseEntity<SyntheticOutput.Contract> preview(@PathVariable String id, @PathVariable int step,
            HttpServletRequest request) {
        DemoSessionController.requireIdentity(request);
        var contract = renderer.render(id, step).contract();
        int status = contract.status().equals("EXAMPLE_NOT_FOUND") ? 404 : 200;
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(contract);
    }

    @GetMapping("/{id}/{step}/pdf")
    public ResponseEntity<?> download(@PathVariable String id, @PathVariable int step, HttpServletRequest request) {
        DemoSessionController.requireIdentity(request);
        var result = renderer.render(id, step);
        if (result.pdf() == null) {
            int status = result.contract().status().equals("EXAMPLE_NOT_FOUND") ? 404 : 422;
            return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(result.contract());
        }
        var attachment = ContentDisposition.attachment().filename(id + ".pdf").build();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, attachment.toString()).body(result.pdf());
    }
}
