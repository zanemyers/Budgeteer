import { Component } from "react";

interface Props {
  message?: string;
}

class LoadingSpinner extends Component<Props> {
  render() {
    const { message = "Loading..." } = this.props;
    return (
      <div className="flex justify-center items-center py-12">
        <div className="spinner-border text-primary mr-4" role="status">
          <span className="sr-only">{message}</span>
        </div>
        <span className="text-muted">{message}</span>
      </div>
    );
  }
}

export default LoadingSpinner;
