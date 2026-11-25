package com.shinjin.pop.shipping;

import com.shinjin.pop.drawing.DrawingShippingBridge;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synthetic.shipping.InMemoryShippingDomain;
import synthetic.shipping.ShippingDomain;

import java.time.Clock;
import java.util.List;

@RestController
@Profile("demo")
@RequestMapping("/api/pop/shipping")
public final class ShippingDemoController {
    public record State(String terminal, String worker, List<ShippingDomain.Snapshot> rows) {}
    public record Failure(String code) {}

    private final DrawingShippingBridge source;
    private final ShippingDomain shipping = new InMemoryShippingDomain(Clock.systemUTC());

    public ShippingDemoController(DrawingShippingBridge source) {
        this.source = source;
    }

    @GetMapping
    public ResponseEntity<State> list(HttpServletRequest request) {
        var actor = refresh(request);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new State(actor.terminal(), actor.worker(), shipping.list(actor)));
    }

    @PostMapping(path = "/commands", consumes = "application/json")
    public ResponseEntity<?> command(HttpServletRequest request, @RequestBody ShippingDomain.Command command) {
        var result = shipping.execute(refresh(request), command);
        return ResponseEntity.status(result.status()).cacheControl(CacheControl.noStore())
                .body(result.status() == 200 ? result.snapshot() : new Failure(result.error()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Failure> malformed() {
        return ResponseEntity.badRequest().body(new Failure("MALFORMED_COMMAND"));
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Failure> sourceError(ResponseStatusException error) {
        String code = switch (error.getStatusCode().value()) {
            case 401 -> "LOGIN_REQUIRED";
            case 403 -> "SHIPPING_SCOPE_UNAVAILABLE";
            default -> "PACKING_SOURCE_UNAVAILABLE";
        };
        return ResponseEntity.status(error.getStatusCode()).body(new Failure(code));
    }

    private ShippingDomain.Actor refresh(HttpServletRequest request) {
        var feed = source.read(request);
        try {
            feed.handoffs().forEach(shipping::publish);
        } catch (IllegalArgumentException | IllegalStateException error) {
            throw new ResponseStatusException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "Packing handoff inconsistent", error);
        }
        return feed.actor();
    }
}
